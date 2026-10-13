import {
  brandSettingsSchema,
  defaultBrandSettings,
  kitchenTicketListSchema,
  type Order,
  orderSchema,
} from '@pos/shared';
import type request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { Prisma } from '../../generated/prisma/client';
import { createUser } from '../../../test/factories';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { createMenuWorld, type MenuWorld } from '../../../test/menu-world';
import { as, errorOf, signIn } from '../../../test/users-world';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
let clock = new Date('2026-10-13T09:00:00Z');
const app = createApp({
  prisma,
  config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }),
  now: () => clock,
});

const MANAGER = { staffCode: '2001', pin: '7351' };
let world: MenuWorld;

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  clock = new Date('2026-10-13T09:00:00Z');
  await resetDatabase(prisma);
  world = await createMenuWorld(prisma, hasher);
  await prisma.user.update({
    where: { id: world.users.mallManager.id },
    data: { staffCode: MANAGER.staffCode, pinHash: await hasher.hash(MANAGER.pin) },
  });
  await createUser(prisma, hasher, {
    roleKey: 'kitchen',
    name: 'Karim Kitchen',
    brandId: world.pizza.id,
    branchIds: [world.mall.id],
    email: 'kitchen@x.io',
  });
});

type Api = ReturnType<typeof as>;
const ORDERS = '/api/v1/orders';
const TICKETS = '/api/v1/kitchen/tickets';
const settingsOf = (brandId: string) => `/api/v1/brands/${brandId}/settings`;
const asAdmin = async () => as(app, await signIn(app, 'admin@x.io'));
const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));
const asBurgerManager = async () => as(app, await signIn(app, 'burger@x.io'));
const asMallManager = async () => as(app, await signIn(app, 'mall-manager@x.io'));
const asCashier = async () => as(app, await signIn(app, 'cashier@x.io'));
const asKitchen = async () => as(app, await signIn(app, 'kitchen@x.io'));

const orderOf = (res: request.Response): Order => orderSchema.parse(res.body);
const codesOf = (res: request.Response) => errorOf(res).details?.map((detail) => detail.message);

const stations = [
  { id: '01990000-0000-7000-8000-00000000a001', name: { en: 'Pizza', ar: 'بيتزا' } },
  { id: '01990000-0000-7000-8000-00000000a002', name: { en: 'Drinks', ar: 'مشروبات' } },
];

// Writes the settings of Pizza straight into the database, as the Settings screen would.
const setPizza = (settings: Prisma.InputJsonObject) =>
  prisma.brand.update({ where: { id: world.pizza.id }, data: { settings } });

// An order at Pizza Mall with a Margherita (20.000) and a Cola (5.000), not sent.
async function orderOf25(api: Api) {
  const order = orderOf(await api.post(ORDERS, { branchId: world.mall.id, type: 'takeaway' }));
  await api.post(`${ORDERS}/${order.id}/lines`, {
    kind: 'item',
    itemId: world.items.margherita.id,
  });
  return orderOf(
    await api.post(`${ORDERS}/${order.id}/lines`, { kind: 'item', itemId: world.items.cola.id }),
  );
}

describe('GET and PUT /brands/:id/settings', () => {
  it('gives every person of the brand the defaults of a brand never set up', async () => {
    const res = await (await asCashier()).get(settingsOf(world.pizza.id));
    expect(res.status).toBe(200);
    expect(brandSettingsSchema.parse(res.body)).toEqual(defaultBrandSettings);

    const other = await (await asCashier()).get(settingsOf(world.burger.id));
    expect(other.status).toBe(404);
  });

  it('lets a brand manager change them, names new stations, and records it', async () => {
    const api = await asPizzaManager();
    const res = await api.put(settingsOf(world.pizza.id), {
      ...defaultBrandSettings,
      paymentMethods: [
        { key: 'knet', name: { en: 'KNET', ar: 'كي نت' } },
        { key: 'talabat', name: { en: 'Talabat', ar: 'طلبات' }, isActive: false },
      ],
      cashierDiscountLimit: '10',
      kitchenStations: [{ name: { en: 'Pizza', ar: 'بيتزا' } }],
    });
    expect(res.status).toBe(200);
    const saved = brandSettingsSchema.parse(res.body);
    expect(saved.cashierDiscountLimit).toBe('10.00');
    expect(saved.paymentMethods[1]).toMatchObject({ key: 'talabat', isActive: false });
    expect(saved.kitchenStations[0]?.id).toMatch(/^[0-9a-f-]{36}$/);

    const [row] = await prisma.auditLog.findMany({ where: { action: 'brand.settings_updated' } });
    expect(row?.metadata).toEqual({
      changed: ['paymentMethods', 'cashierDiscountLimit', 'kitchenStations'],
    });
    expect(brandSettingsSchema.parse((await api.get(settingsOf(world.pizza.id))).body)).toEqual(
      saved,
    );
  });

  it('refuses a branch manager, a cashier, and another brand', async () => {
    for (const api of [await asMallManager(), await asCashier()]) {
      expect((await api.put(settingsOf(world.pizza.id), defaultBrandSettings)).status).toBe(403);
    }
    expect(
      (await (await asBurgerManager()).put(settingsOf(world.pizza.id), defaultBrandSettings))
        .status,
    ).toBe(404);
    expect(
      (await (await asAdmin()).put(settingsOf(world.pizza.id), defaultBrandSettings)).status,
    ).toBe(200);
  });

  it('checks the request', async () => {
    const res = await (
      await asPizzaManager()
    ).put(settingsOf(world.pizza.id), {
      ...defaultBrandSettings,
      paymentMethods: [{ key: 'cash', name: { en: 'Cash', ar: 'نقد' } }],
      voidNeedsManager: 'sometimes',
    });
    expect(res.status).toBe(400);
    expect(codesOf(res)).toEqual(
      expect.arrayContaining(['PAYMENT_METHOD_KEY_INVALID', 'VOID_RULE_INVALID']),
    );
  });
});

describe('payment methods (criteria 1 and 2)', () => {
  it('pays by KNET and cash, and the payment carries the name of the method', async () => {
    await setPizza({
      paymentMethods: [
        { key: 'knet', name: { en: 'KNET', ar: 'كي نت' }, isActive: true },
        { key: 'link', name: { en: 'Link', ar: 'لينك' }, isActive: true },
      ],
    });
    const api = await asCashier();
    const order = await orderOf25(api);

    const paid = orderOf(
      await api.post(`${ORDERS}/${order.id}/pay`, {
        tenders: [
          {
            id: '01990000-0000-7000-8000-00000000b001',
            method: 'knet',
            amount: '20',
            reference: 'A1',
          },
          {
            id: '01990000-0000-7000-8000-00000000b002',
            method: 'cash',
            amount: '5',
            tendered: '10',
          },
        ],
      }),
    );
    expect(paid.status).toBe('paid');
    expect(paid.change).toBe('5.000');
    expect(
      paid.payments.map((payment) => [payment.method, payment.methodName.en, payment.amount]),
    ).toEqual(
      expect.arrayContaining([
        ['knet', 'KNET', '20.000'],
        ['cash', 'Cash', '5.000'],
      ]),
    );
  });

  it('refuses a method that is switched off or not in the list', async () => {
    await setPizza({
      paymentMethods: [{ key: 'talabat', name: { en: 'Talabat', ar: 'طلبات' }, isActive: false }],
    });
    const api = await asCashier();
    const order = await orderOf25(api);

    for (const method of ['talabat', 'card']) {
      const res = await api.post(`${ORDERS}/${order.id}/pay`, {
        tenders: [{ id: '01990000-0000-7000-8000-00000000b003', method, amount: '25' }],
      });
      expect(res.status).toBe(400);
      expect(errorOf(res).details).toEqual([
        { path: 'tenders.0.method', message: 'PAYMENT_METHOD_INVALID' },
      ]);
    }
    expect(await prisma.payment.count()).toBe(0);
  });
});

describe('the cashier discount limit (criterion 3)', () => {
  it('needs no manager within the limit, and one above it', async () => {
    await setPizza({ cashierDiscountLimit: '10' });
    const api = await asCashier();
    const order = await orderOf25(api);

    const ten = await api.put(`${ORDERS}/${order.id}/discount`, {
      kind: 'percent',
      value: '10',
      reason: 'Regular',
    });
    expect(ten.status).toBe(200);
    expect(orderOf(ten).total).toBe('22.500');

    const fifteen = await api.put(`${ORDERS}/${order.id}/discount`, {
      kind: 'percent',
      value: '15',
      reason: 'Regular',
    });
    expect(errorOf(fifteen).details).toEqual([{ path: 'approval', message: 'APPROVAL_REQUIRED' }]);
    const amount = await api.put(`${ORDERS}/${order.id}/discount`, {
      kind: 'amount',
      value: '1',
      reason: 'Regular',
    });
    expect(errorOf(amount).details).toEqual([{ path: 'approval', message: 'APPROVAL_REQUIRED' }]);

    // Taking back the 10% needs no manager either.
    const removed = await api.delete(`${ORDERS}/${order.id}/discount`, {});
    expect(removed.status).toBe(200);
    expect(orderOf(removed).discount).toBeNull();
  });
});

describe('the end of the business day (criterion 4)', () => {
  it('counts an order before the hour for the day before', async () => {
    await prisma.branch.update({
      where: { id: world.mall.id },
      data: { timezone: 'Asia/Kuwait', config: { dayEndsAt: '04:00' } },
    });
    const api = await asCashier();

    // 01:30 on Tuesday 13 October in Kuwait.
    clock = new Date('2026-10-12T22:30:00Z');
    const late = orderOf(await api.post(ORDERS, { branchId: world.mall.id, type: 'takeaway' }));
    expect(late).toMatchObject({ businessDate: '2026-10-12', number: 1 });

    // 05:00 on Tuesday: a new day, and the numbers start again.
    clock = new Date('2026-10-13T02:00:00Z');
    const morning = orderOf(await api.post(ORDERS, { branchId: world.mall.id, type: 'takeaway' }));
    expect(morning).toMatchObject({ businessDate: '2026-10-13', number: 1 });
  });
});

describe('the void rule (criterion 5)', () => {
  it('lets a cashier void a sent line alone when the rule is never, and records them', async () => {
    const api = await asCashier();
    const order = await orderOf25(api);
    await api.post(`${ORDERS}/${order.id}/send`);
    const cola = order.lines[1];
    if (!cola) throw new Error('The order has a cola');

    const res = await api.post(`${ORDERS}/${order.id}/lines/${cola.id}/void`, {
      reason: 'Wrong item',
    });
    expect(res.status).toBe(200);
    expect(orderOf(res).lines[1]?.status).toBe('voided');
    const [row] = await prisma.auditLog.findMany({ where: { action: 'order.line_voided' } });
    expect(row).toMatchObject({ userId: world.users.cashier.id });
    expect(row?.metadata).toMatchObject({ approvedById: null });

    const whole = await api.post(`${ORDERS}/${order.id}/void`, { reason: 'Customer left' });
    expect(orderOf(whole).status).toBe('voided');
  });

  it('needs a manager for everything when the rule is always', async () => {
    await setPizza({ voidNeedsManager: 'always' });
    const api = await asCashier();
    const order = await orderOf25(api);

    const refused = await api.post(`${ORDERS}/${order.id}/void`, { reason: 'Customer left' });
    expect(errorOf(refused).details).toEqual([{ path: 'approval', message: 'APPROVAL_REQUIRED' }]);
    const allowed = await api.post(`${ORDERS}/${order.id}/void`, {
      reason: 'Customer left',
      approval: MANAGER,
    });
    expect(orderOf(allowed).status).toBe('voided');
  });
});

describe('kitchen stations (criterion 6)', () => {
  it('makes one ticket per station, which each screen sees on its own', async () => {
    await setPizza({ kitchenStations: stations });
    await prisma.menuCategory.update({
      where: { id: world.categories.pizzas.id },
      data: { stationId: stations[0]?.id },
    });
    await prisma.menuCategory.update({
      where: { id: world.categories.drinks.id },
      data: { stationId: stations[1]?.id },
    });
    const api = await asCashier();
    const order = await orderOf25(api);
    const sent = orderOf(await api.post(`${ORDERS}/${order.id}/send`));
    expect(new Set(sent.lines.map((line) => line.ticketId)).size).toBe(2);

    const kitchen = await asKitchen();
    const all = kitchenTicketListSchema.parse(
      (await kitchen.get(`${TICKETS}?branchId=${world.mall.id}`)).body,
    ).data;
    expect(
      all.map((ticket) => [ticket.stationId, ticket.lines.map((line) => line.name.en)]),
    ).toEqual(
      expect.arrayContaining([
        [stations[0]?.id, ['Margherita']],
        [stations[1]?.id, ['Cola']],
      ]),
    );

    const drinks = kitchenTicketListSchema.parse(
      (await kitchen.get(`${TICKETS}?branchId=${world.mall.id}&stationId=${stations[1]?.id}`)).body,
    ).data;
    expect(drinks.map((ticket) => ticket.lines.map((line) => line.name.en))).toEqual([['Cola']]);
  });

  it('refuses a category pointed at a station the brand does not have', async () => {
    const res = await (
      await asPizzaManager()
    ).patch(`/api/v1/menu/categories/${world.categories.pizzas.id}`, {
      stationId: stations[0]?.id,
    });
    expect(res.status).toBe(400);
    expect(codesOf(res)).toEqual(['STATION_NOT_FOUND']);
  });
});

describe('who marks a ticket done (criterion 7)', () => {
  it('lets the cashier mark a ready ticket done when the brand says so, and nobody else', async () => {
    const api = await asCashier();
    const order = await orderOf25(api);
    const sent = orderOf(await api.post(`${ORDERS}/${order.id}/send`));
    const ticketId = sent.lines[0]?.ticketId;
    if (!ticketId) throw new Error('The lines are on a ticket');
    await (await asKitchen()).patch(`${TICKETS}/${ticketId}`, { from: 'new', to: 'ready' });

    const refused = await api.patch(`${TICKETS}/${ticketId}`, { from: 'ready', to: 'done' });
    expect(refused.status).toBe(403);

    await setPizza({ ticketDoneBy: 'cashier' });
    const notReady = await api.patch(`${TICKETS}/${ticketId}`, { from: 'done', to: 'ready' });
    expect(notReady.status).toBe(403);
    const done = await api.patch(`${TICKETS}/${ticketId}`, { from: 'ready', to: 'done' });
    expect(done.status).toBe(200);
    expect(orderOf(await api.get(`${ORDERS}/${order.id}`)).lines[0]?.kitchenStatus).toBe('done');
  });
});
