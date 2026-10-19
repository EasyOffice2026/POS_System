import { randomUUID } from 'node:crypto';
import { type Order, orderSchema } from '@pos/shared';
import type request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { createItem, openShift } from '../../../test/factories';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { createMenuWorld, type MenuWorld } from '../../../test/menu-world';
import { as, errorOf, signIn } from '../../../test/users-world';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const clock = new Date('2026-10-13T09:00:00Z');
const app = createApp({
  prisma,
  config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }),
  now: () => clock,
});

let world: MenuWorld;

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  world = await createMenuWorld(prisma, hasher);
  await openShift(prisma, world.users.cashier, world.mall);
});

type Api = ReturnType<typeof as>;
const ORDERS = '/api/v1/orders';
const asCashier = async () => as(app, await signIn(app, 'cashier@x.io'));
const asBurgerManager = async () => as(app, await signIn(app, 'burger@x.io'));

const orderOf = (res: request.Response): Order => orderSchema.parse(res.body);
const codesOf = (res: request.Response) => errorOf(res).details?.map((detail) => detail.message);

const cash = (amount: string, tendered: string, id = randomUUID()) => ({
  id,
  method: 'cash',
  amount,
  tendered,
});
const card = (amount: string, reference = 'K1', id = randomUUID()) => ({
  id,
  method: 'knet',
  amount,
  reference,
});

// An order of 72.000 at Pizza Mall: 50.000 and 30.000 with a 10% discount, nothing sent yet.
async function orderOf72(api: Api) {
  const fifty = await createItem(
    prisma,
    world.pizza.id,
    world.categories.pizzas.id,
    'Family',
    '50.000',
  );
  const thirty = await createItem(
    prisma,
    world.pizza.id,
    world.categories.pizzas.id,
    'Large',
    '30.000',
  );
  const opened = orderOf(await api.post(ORDERS, { branchId: world.mall.id, type: 'takeaway' }));
  await api.post(`${ORDERS}/${opened.id}/lines`, { kind: 'item', itemId: fifty.id });
  await api.post(`${ORDERS}/${opened.id}/lines`, { kind: 'item', itemId: thirty.id });
  await prisma.order.update({
    where: { id: opened.id },
    data: { discountKind: 'percent', discountValue: '10', discountAmount: '8', total: '72' },
  });
  return opened;
}

const pay = (api: Api, orderId: string, tenders: object[]) =>
  api.post(`${ORDERS}/${orderId}/pay`, { tenders });

describe('POST /orders/:id/pay', () => {
  it('takes cash and gives the change (criterion 1)', async () => {
    const api = await asCashier();
    const order = await orderOf72(api);

    const res = await pay(api, order.id, [cash('72', '100')]);
    expect(res.status).toBe(200);
    const paid = orderOf(res);
    expect(paid).toMatchObject({
      status: 'paid',
      total: '72.000',
      change: '28.000',
      paidAt: clock.toISOString(),
      paidById: world.users.cashier.id,
    });
    expect(paid.payments).toEqual([
      expect.objectContaining({
        method: 'cash',
        amount: '72.000',
        tendered: '100.000',
        change: '28.000',
        reference: null,
        takenById: world.users.cashier.id,
      }),
    ]);
  });

  it('splits between a card and cash (criterion 2)', async () => {
    const api = await asCashier();
    const order = await orderOf72(api);

    const paid = orderOf(await pay(api, order.id, [card('50', '  4821 '), cash('22', '22')]));
    expect(paid.status).toBe('paid');
    expect(paid.change).toBe('0.000');
    const parts = paid.payments.map((payment) => [
      payment.method,
      payment.amount,
      payment.reference,
    ]);
    expect(parts).toHaveLength(2);
    expect(parts).toEqual(
      expect.arrayContaining([
        ['knet', '50.000', '4821'],
        ['cash', '22.000', null],
      ]),
    );
  });

  it('closes the order to every change (criterion 3)', async () => {
    const api = await asCashier();
    const order = await orderOf72(api);
    await pay(api, order.id, [cash('72', '72')]);

    const add = await api.post(`${ORDERS}/${order.id}/lines`, {
      kind: 'item',
      itemId: world.items.cola.id,
    });
    expect(add.status).toBe(409);
    expect(errorOf(add).code).toBe('ORDER_NOT_OPEN');
    const voided = await api.post(`${ORDERS}/${order.id}/void`, { reason: 'Changed mind' });
    expect(errorOf(voided).code).toBe('ORDER_NOT_OPEN');
    const again = await pay(api, order.id, [cash('72', '72')]);
    expect(errorOf(again).code).toBe('ORDER_NOT_OPEN');
  });

  it('refuses parts that do not add up to the total, and stores nothing (criterion 4)', async () => {
    const api = await asCashier();
    const order = await orderOf72(api);

    const short = await pay(api, order.id, [cash('70', '100')]);
    expect(short.status).toBe(400);
    expect(codesOf(short)).toEqual(['PAYMENT_TOTAL_MISMATCH']);
    const over = await pay(api, order.id, [card('80')]);
    expect(codesOf(over)).toEqual(['PAYMENT_TOTAL_MISMATCH']);

    expect(await prisma.payment.count()).toBe(0);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.status).toBe('open');
    expect(await prisma.orderLine.count({ where: { status: 'sent' } })).toBe(0);
  });

  it('takes a payment sent twice once (criterion 5)', async () => {
    const api = await asCashier();
    const order = await orderOf72(api);
    const tenders = [card('50'), cash('22', '30')];

    const first = orderOf(await pay(api, order.id, tenders));
    const second = await pay(api, order.id, tenders);
    expect(second.status).toBe(200);
    expect(orderOf(second)).toEqual(first);
    expect(await prisma.payment.count()).toBe(2);
  });

  it('sends the lines that were not sent (criterion 6)', async () => {
    const api = await asCashier();
    const order = await orderOf72(api);

    const paid = orderOf(await pay(api, order.id, [cash('72', '72')]));
    expect(paid.lines.map((line) => [line.status, line.sentAt])).toEqual([
      ['sent', clock.toISOString()],
      ['sent', clock.toISOString()],
    ]);
  });

  it('pays an order that costs nothing with no part, but not one that costs something', async () => {
    const api = await asCashier();
    const order = await orderOf72(api);

    const none = await pay(api, order.id, []);
    expect(codesOf(none)).toEqual(['PAYMENT_TENDERS_INVALID']);

    await prisma.order.update({
      where: { id: order.id },
      data: { discountKind: 'percent', discountValue: '100', discountAmount: '80', total: '0' },
    });
    const free = orderOf(await pay(api, order.id, []));
    expect(free).toMatchObject({ status: 'paid', payments: [], change: '0.000' });
  });

  it('refuses an order with nothing on it', async () => {
    const api = await asCashier();
    const order = orderOf(await api.post(ORDERS, { branchId: world.mall.id, type: 'takeaway' }));
    const res = await pay(api, order.id, []);
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('ORDER_EMPTY');
  });

  it('checks each part', async () => {
    const api = await asCashier();
    const order = await orderOf72(api);

    expect(codesOf(await pay(api, order.id, [cash('72', '50')]))).toEqual([
      'PAYMENT_TENDERED_SHORT',
    ]);
    expect(codesOf(await pay(api, order.id, [cash('36', '36'), cash('36', '36')]))).toEqual([
      'PAYMENT_TOO_MANY_CASH',
    ]);
    expect(codesOf(await pay(api, order.id, [card('0')]))).toEqual(['PAYMENT_AMOUNT_INVALID']);
  });

  it('answers 409 for an id another brand used, and hides other brands', async () => {
    const api = await asCashier();
    const order = await orderOf72(api);
    const id = randomUUID();
    await pay(api, order.id, [cash('72', '72', id)]);

    const burger = await asBurgerManager();
    await openShift(prisma, world.users.burgerManager, world.airport);
    expect((await pay(burger, order.id, [cash('72', '72')])).status).toBe(404);

    const cheese = orderOf(
      await burger.post(ORDERS, { branchId: world.airport.id, type: 'takeaway' }),
    );
    await burger.post(`${ORDERS}/${cheese.id}/lines`, {
      kind: 'item',
      itemId: world.items.cheeseburger.id,
    });
    const taken = await pay(burger, cheese.id, [cash('18', '18', id)]);
    expect(taken.status).toBe(409);
    expect(errorOf(taken).code).toBe('PAYMENT_ID_TAKEN');
  });

  it('lists the paid orders', async () => {
    const api = await asCashier();
    const order = await orderOf72(api);
    await api.post(ORDERS, { branchId: world.mall.id, type: 'takeaway' });
    await pay(api, order.id, [cash('72', '72')]);

    const res = await api.get(`${ORDERS}?status=paid`);
    expect((res.body as { data: { id: string; paidAt: string }[] }).data).toEqual([
      expect.objectContaining({ id: order.id, paidAt: clock.toISOString() }),
    ]);
  });
});
