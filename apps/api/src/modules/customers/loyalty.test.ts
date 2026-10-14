import { randomUUID } from 'node:crypto';
import {
  customerDetailSchema,
  customerSchema,
  type LoyaltySettings,
  type Order,
  orderSchema,
  pageSchema,
} from '@pos/shared';
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
const app = createApp({ prisma, config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }) });

let world: MenuWorld;
const on: LoyaltySettings = { enabled: true, pointsPerKwd: 1, pointValue: '0.010', minRedeem: 100 };

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  world = await createMenuWorld(prisma, hasher);
  await openShift(prisma, world.users.cashier, world.mall);
  await setLoyalty(on);
});

function setLoyalty(loyalty: LoyaltySettings) {
  return prisma.brand.update({ where: { id: world.pizza.id }, data: { settings: { loyalty } } });
}

type Api = ReturnType<typeof as>;
const ORDERS = '/api/v1/orders';
const CUSTOMERS = '/api/v1/customers';
const asCashier = async () => as(app, await signIn(app, 'cashier@x.io'));
const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));

const orderOf = (res: request.Response): Order => orderSchema.parse(res.body);
const messagesOf = (res: request.Response) =>
  (errorOf(res).details ?? []).map((detail) => `${detail.path}:${detail.message}`);

async function orderWith(api: Api, itemId: string, quantity = 1) {
  const opened = orderOf(await api.post(ORDERS, { branchId: world.mall.id, type: 'takeaway' }));
  const res = await api.post(`${ORDERS}/${opened.id}/lines`, { kind: 'item', itemId, quantity });
  expect(res.status).toBe(200);
  return orderOf(res);
}

const pay = (api: Api, order: Order) =>
  api.post(`${ORDERS}/${order.id}/pay`, {
    tenders: [{ id: randomUUID(), method: 'cash', amount: order.total, tendered: order.total }],
  });

function regular(points: number) {
  return prisma.customer.create({
    data: {
      brandId: world.pizza.id,
      phone: '+96555550000',
      name: 'Sara',
      searchText: '+96555550000 sara',
      points,
    },
  });
}

describe('a customer on an order', () => {
  it('is added by phone and earns points when the order is paid (criterion 1)', async () => {
    const item = await createItem(
      prisma,
      world.pizza.id,
      world.categories.pizzas.id,
      'Big',
      '28.300',
    );
    const api = await asCashier();
    const order = await orderWith(api, item.id);

    const withCustomer = orderOf(
      await api.put(`${ORDERS}/${order.id}/customer`, { phone: '9999 1234', name: 'Noor' }),
    );
    expect(withCustomer.customer).toMatchObject({ phone: '+96599991234', name: 'Noor', points: 0 });

    const paid = orderOf(await pay(api, withCustomer));
    expect(paid).toMatchObject({ status: 'paid', pointsEarned: 28 });
    expect(paid.customer?.points).toBe(28);
    const customer = await prisma.customer.findFirstOrThrow({ where: { phone: '+96599991234' } });
    expect(customer).toMatchObject({ points: 28, visits: 1 });
    expect(customer.totalSpent.toFixed(3)).toBe('28.300');
    const entries = await prisma.loyaltyEntry.findMany();
    expect(entries.map((row) => [row.kind, row.points, row.balanceAfter, row.orderId])).toEqual([
      ['earn', 28, 28, order.id],
    ]);
    await expect(prisma.auditLog.count({ where: { action: 'customer.created' } })).resolves.toBe(1);
  });

  it('spends points as a discount, taken from the balance when paid (criterion 2)', async () => {
    await regular(300);
    const api = await asCashier();
    const order = await orderWith(api, world.items.cola.id, 2);
    await api.put(`${ORDERS}/${order.id}/customer`, { phone: '+965 5555 0000' });

    const spent = orderOf(await api.put(`${ORDERS}/${order.id}/points`, { points: 200 }));
    expect(spent).toMatchObject({ pointsRedeemed: 200, pointsDiscount: '2.000', total: '8.000' });
    expect(spent.customer?.points).toBe(300);

    const paid = orderOf(await pay(api, spent));
    expect(paid).toMatchObject({ pointsEarned: 8 });
    expect(paid.customer?.points).toBe(108);
    const entries = await prisma.loyaltyEntry.findMany({ orderBy: { points: 'asc' } });
    expect(entries.map((row) => [row.kind, row.points, row.balanceAfter])).toEqual([
      ['redeem', -200, 100],
      ['earn', 8, 108],
    ]);
  });

  it('refuses too few, more than the customer has, and more than the order needs (criterion 3)', async () => {
    await regular(300);
    const small = await createItem(
      prisma,
      world.pizza.id,
      world.categories.drinks.id,
      'Water',
      '1.000',
    );
    const api = await asCashier();
    const order = await orderWith(api, small.id);
    await api.put(`${ORDERS}/${order.id}/customer`, { phone: '55550000' });

    expect(messagesOf(await api.put(`${ORDERS}/${order.id}/points`, { points: 50 }))).toEqual([
      'points:POINTS_TOO_FEW',
    ]);
    expect(messagesOf(await api.put(`${ORDERS}/${order.id}/points`, { points: 400 }))).toEqual([
      'points:POINTS_NOT_ENOUGH',
    ]);
    expect(messagesOf(await api.put(`${ORDERS}/${order.id}/points`, { points: 150 }))).toEqual([
      'points:POINTS_TOO_MANY',
    ]);
    const exact = orderOf(await api.put(`${ORDERS}/${order.id}/points`, { points: 100 }));
    expect(exact).toMatchObject({ pointsDiscount: '1.000', total: '0.000' });
  });

  it('keeps only the points an order that shrank can use, and loses them with the customer', async () => {
    await regular(1000);
    const api = await asCashier();
    const order = await orderWith(api, world.items.cola.id, 2);
    await api.put(`${ORDERS}/${order.id}/customer`, { phone: '55550000' });
    const spent = orderOf(await api.put(`${ORDERS}/${order.id}/points`, { points: 1000 }));
    expect(spent).toMatchObject({ pointsRedeemed: 1000, total: '0.000' });

    const line = spent.lines[0];
    const smaller = orderOf(
      await api.patch(`${ORDERS}/${order.id}/lines/${line?.id}`, { quantity: 1 }),
    );
    expect(smaller).toMatchObject({ pointsRedeemed: 500, pointsDiscount: '5.000', total: '0.000' });

    const gone = orderOf(await api.delete(`${ORDERS}/${order.id}/customer`));
    expect(gone).toMatchObject({ customer: null, pointsRedeemed: 0, total: '5.000' });
  });

  it('earns nothing and spends nothing when loyalty is off (criterion 4)', async () => {
    await setLoyalty({ ...on, enabled: false });
    await regular(300);
    const api = await asCashier();
    const order = await orderWith(api, world.items.cola.id, 2);
    await api.put(`${ORDERS}/${order.id}/customer`, { phone: '55550000' });

    const off = await api.put(`${ORDERS}/${order.id}/points`, { points: 100 });
    expect(off.status).toBe(409);
    expect(errorOf(off).code).toBe('LOYALTY_OFF');
    const paid = orderOf(await pay(api, orderOf(await api.get(`${ORDERS}/${order.id}`))));
    expect(paid).toMatchObject({ pointsEarned: 0 });
    expect(paid.customer?.points).toBe(300);
    await expect(prisma.customer.findFirstOrThrow()).resolves.toMatchObject({ visits: 1 });
  });
});

describe('customers in the back office', () => {
  it('get points by hand with a reason, never below zero (criterion 5)', async () => {
    const customer = await regular(100);
    const api = await asPizzaManager();

    const taken = await api.post(`${CUSTOMERS}/${customer.id}/points`, {
      points: -500,
      reason: 'x',
    });
    expect(messagesOf(taken)).toEqual(['points:POINTS_NOT_ENOUGH']);

    const given = customerDetailSchema.parse(
      (await api.post(`${CUSTOMERS}/${customer.id}/points`, { points: 50, reason: 'Cold pizza' }))
        .body,
    );
    expect(given.points).toBe(150);
    expect(given.entries.map((row) => [row.kind, row.points, row.balanceAfter, row.note])).toEqual([
      ['adjust', 50, 150, 'Cold pizza'],
    ]);
    await expect(
      prisma.auditLog.count({ where: { action: 'customer.points_adjusted' } }),
    ).resolves.toBe(1);

    const renamed = customerDetailSchema.parse(
      (await api.patch(`${CUSTOMERS}/${customer.id}`, { name: 'Sara A.', email: 'Sara@X.io' }))
        .body,
    );
    expect(renamed).toMatchObject({ name: 'Sara A.', email: 'sara@x.io' });
    const found = pageSchema(customerSchema).parse(
      (await api.get(`${CUSTOMERS}?brandId=${world.pizza.id}&q=sara`)).body,
    );
    expect(found.data.map((row) => row.id)).toEqual([customer.id]);
    const other = pageSchema(customerSchema).parse(
      (await api.get(`${CUSTOMERS}?brandId=${world.burger.id}`)).body,
    );
    expect(other.data).toEqual([]);
  });

  it('are found by the cashier by phone, but listed only for managers (criterion 6)', async () => {
    const customer = await regular(10);
    const cashier = await asCashier();
    const found = customerSchema.parse(
      (await cashier.get(`${CUSTOMERS}/lookup?phone=55550000`)).body,
    );
    expect(found.id).toBe(customer.id);
    expect((await cashier.get(`${CUSTOMERS}/lookup?phone=55550001`)).status).toBe(404);
    expect((await cashier.get(CUSTOMERS)).status).toBe(403);

    const mall = as(app, await signIn(app, 'mall-manager@x.io'));
    expect((await mall.get(`${CUSTOMERS}/${customer.id}`)).status).toBe(200);
    expect(
      (await mall.post(`${CUSTOMERS}/${customer.id}/points`, { points: 5, reason: 'x' })).status,
    ).toBe(403);

    const burger = as(app, await signIn(app, 'burger@x.io'));
    expect((await burger.get(`${CUSTOMERS}/${customer.id}`)).status).toBe(404);
    expect(pageSchema(customerSchema).parse((await burger.get(CUSTOMERS)).body).data).toEqual([]);
  });
});
