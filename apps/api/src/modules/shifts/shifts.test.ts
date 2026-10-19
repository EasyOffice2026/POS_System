import { type Order, orderSchema, shiftReportSchema, shiftSummarySchema } from '@pos/shared';
import type request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { createMenuWorld, type MenuWorld } from '../../../test/menu-world';
import { as, errorOf, signIn } from '../../../test/users-world';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
let clock = new Date('2026-10-13T06:00:00Z');
const app = createApp({
  prisma,
  config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }),
  now: () => clock,
});

let world: MenuWorld;

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  clock = new Date('2026-10-13T06:00:00Z');
  await resetDatabase(prisma);
  world = await createMenuWorld(prisma, hasher);
  await prisma.brand.update({
    where: { id: world.pizza.id },
    data: {
      settings: {
        paymentMethods: [{ key: 'knet', name: { en: 'KNET', ar: 'كي نت' }, isActive: true }],
      },
    },
  });
});

type Api = ReturnType<typeof as>;
const SHIFTS = '/api/v1/shifts';
const ORDERS = '/api/v1/orders';
const asCashier = async () => as(app, await signIn(app, 'cashier@x.io'));
const asMallManager = async () => as(app, await signIn(app, 'mall-manager@x.io'));
const asBurgerManager = async () => as(app, await signIn(app, 'burger@x.io'));

const summaryOf = (res: request.Response) => shiftSummarySchema.parse(res.body);
const reportOf = (res: request.Response) => shiftReportSchema.parse(res.body);
const orderOf = (res: request.Response): Order => orderSchema.parse(res.body);

async function openShift(api: Api, openingCash = '50') {
  const res = await api.post(SHIFTS, { branchId: world.mall.id, openingCash });
  expect(res.status).toBe(201);
  return summaryOf(res);
}

// An order of a Cola (5.000) and a Margherita (20.000), paid as said.
async function paidOrder(api: Api, tenders: object[]) {
  const order = orderOf(await api.post(ORDERS, { branchId: world.mall.id, type: 'takeaway' }));
  await api.post(`${ORDERS}/${order.id}/lines`, { kind: 'item', itemId: world.items.cola.id });
  await api.post(`${ORDERS}/${order.id}/lines`, {
    kind: 'item',
    itemId: world.items.margherita.id,
  });
  const res = await api.post(`${ORDERS}/${order.id}/pay`, { tenders });
  expect(res.status).toBe(200);
  return orderOf(res);
}

const cash = (amount: string, tendered: string, n = 1) => ({
  id: `01990000-0000-7000-8000-00000000c${String(n).padStart(3, '0')}`,
  method: 'cash',
  amount,
  tendered,
});
const knet = (amount: string, n = 1) => ({
  id: `01990000-0000-7000-8000-00000000d${String(n).padStart(3, '0')}`,
  method: 'knet',
  amount,
  reference: 'K1',
});

describe('POST /shifts', () => {
  it('opens a shift with the cash in the drawer, named after the person', async () => {
    const api = await asCashier();
    const shift = await openShift(api, '50');
    expect(shift).toMatchObject({
      branchId: world.mall.id,
      status: 'open',
      openedById: world.users.cashier.id,
      openedByName: 'Sara Cashier',
      openedAt: clock.toISOString(),
      openingCash: '50.000',
      closedAt: null,
      figures: { ordersPaid: 0, sales: '0.000', byMethod: [], cashExpected: '50.000' },
    });
    const [row] = await prisma.auditLog.findMany({ where: { action: 'shift.opened' } });
    expect(row?.metadata).toEqual({ openingCash: '50.000' });
  });

  it('refuses a second open shift at the same branch (criterion 4)', async () => {
    const api = await asCashier();
    await openShift(api);
    const res = await api.post(SHIFTS, { branchId: world.mall.id, openingCash: '10' });
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('SHIFT_ALREADY_OPEN');
  });

  it('refuses a branch the person does not work at, and a switched-off one', async () => {
    const api = await asCashier();
    expect((await api.post(SHIFTS, { branchId: world.downtown.id, openingCash: '1' })).status).toBe(
      404,
    );
    await prisma.branch.update({ where: { id: world.mall.id }, data: { isActive: false } });
    const off = await api.post(SHIFTS, { branchId: world.mall.id, openingCash: '1' });
    expect(off.status).toBe(403);
    expect(errorOf(off).code).toBe('BRANCH_INACTIVE');
  });
});

describe('payments and the shift', () => {
  it('needs an open shift (criterion 3)', async () => {
    const api = await asCashier();
    const order = orderOf(await api.post(ORDERS, { branchId: world.mall.id, type: 'takeaway' }));
    await api.post(`${ORDERS}/${order.id}/lines`, { kind: 'item', itemId: world.items.cola.id });
    const res = await api.post(`${ORDERS}/${order.id}/pay`, { tenders: [cash('5', '5')] });
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('SHIFT_REQUIRED');
    expect(await prisma.payment.count()).toBe(0);
  });

  it('counts the cash taken into the expected cash (criterion 1)', async () => {
    const api = await asCashier();
    const shift = await openShift(api, '50');
    await paidOrder(api, [cash('25', '30')]);

    const current = summaryOf(await api.get(`${SHIFTS}/current?branchId=${world.mall.id}`));
    expect(current.id).toBe(shift.id);
    expect(current.figures).toEqual({
      ordersPaid: 1,
      sales: '25.000',
      discounts: '0.000',
      byMethod: [{ method: 'cash', methodName: { en: 'Cash', ar: 'نقدًا' }, amount: '25.000' }],
      refunds: '0.000',
      refundsByMethod: [],
      cashExpected: '75.000',
    });
  });

  it('counts each way to pay, and an order once (criterion 5)', async () => {
    const api = await asCashier();
    await openShift(api, '0');
    await paidOrder(api, [knet('25', 1)]);
    await paidOrder(api, [knet('20', 2), cash('5', '5', 2)]);

    const report = reportOf(await api.get(`${SHIFTS}/${(await current(api)).id}`));
    expect(report.figures.ordersPaid).toBe(2);
    expect(report.figures.sales).toBe('50.000');
    expect(report.figures.byMethod).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'knet', amount: '45.000' }),
        expect.objectContaining({ method: 'cash', amount: '5.000' }),
      ]),
    );
    expect(report.figures.cashExpected).toBe('5.000');
  });
});

async function current(api: Api) {
  return summaryOf(await api.get(`${SHIFTS}/current?branchId=${world.mall.id}`));
}

describe('POST /shifts/:id/close', () => {
  it('closes with the count and the difference, and records it (criterion 2)', async () => {
    const api = await asCashier();
    const shift = await openShift(api, '50');
    await paidOrder(api, [cash('25', '30')]);

    clock = new Date('2026-10-13T14:00:00Z');
    const res = await api.post(`${SHIFTS}/${shift.id}/close`, {
      countedCash: '74.5',
      note: 'Coins short',
    });
    expect(res.status).toBe(200);
    const report = reportOf(res);
    expect(report).toMatchObject({
      status: 'closed',
      closedById: world.users.cashier.id,
      closedByName: 'Sara Cashier',
      closedAt: clock.toISOString(),
      countedCash: '74.500',
      expectedCash: '75.000',
      difference: '-0.500',
      note: 'Coins short',
    });
    const [row] = await prisma.auditLog.findMany({ where: { action: 'shift.closed' } });
    expect(row?.metadata).toMatchObject({ difference: '-0.500', expectedCash: '75.000' });

    const again = await api.post(`${SHIFTS}/${shift.id}/close`, { countedCash: '75' });
    expect(again.status).toBe(409);
    expect(errorOf(again).code).toBe('SHIFT_NOT_OPEN');
    expect(
      (await api.get(`${SHIFTS}/current?branchId=${world.mall.id}`)).body as unknown,
    ).toBeNull();
  });

  it('puts the voids of the shift on the report', async () => {
    const api = await asCashier();
    const shift = await openShift(api);
    const order = orderOf(await api.post(ORDERS, { branchId: world.mall.id, type: 'takeaway' }));
    await api.post(`${ORDERS}/${order.id}/lines`, { kind: 'item', itemId: world.items.cola.id });
    await api.post(`${ORDERS}/${order.id}/void`, { reason: 'Customer left' });

    const report = reportOf(await api.get(`${SHIFTS}/${shift.id}`));
    expect(report.voids).toEqual({
      orders: 1,
      ordersValue: '5.000',
      lines: 0,
      linesValue: '0.000',
    });
  });

  it("lets the branch manager close a cashier's shift, and names both (criterion 6)", async () => {
    const cashier = await asCashier();
    const shift = await openShift(cashier);
    const manager = await asMallManager();

    const res = await manager.post(`${SHIFTS}/${shift.id}/close`, { countedCash: '50' });
    expect(res.status).toBe(200);
    expect(reportOf(res)).toMatchObject({
      closedById: world.users.mallManager.id,
      closedByName: 'Maha Mall Manager',
      difference: '0.000',
    });
    const [row] = await prisma.auditLog.findMany({ where: { action: 'shift.closed' } });
    expect(row).toMatchObject({ userId: world.users.mallManager.id });
    expect(row?.metadata).toMatchObject({ openedById: world.users.cashier.id });
  });

  it("refuses another cashier's shift to a cashier", async () => {
    const manager = await asMallManager();
    const shift = summaryOf(
      await manager.post(SHIFTS, { branchId: world.mall.id, openingCash: '1' }),
    );
    const cashier = await asCashier();
    expect((await cashier.get(`${SHIFTS}/${shift.id}`)).status).toBe(403);
    expect((await cashier.post(`${SHIFTS}/${shift.id}/close`, { countedCash: '1' })).status).toBe(
      403,
    );
  });
});

describe('GET /shifts', () => {
  it('lists the shifts of a branch for a manager, open ones first (criteria 7 and 9)', async () => {
    const cashier = await asCashier();
    const first = await openShift(cashier, '10');
    await cashier.post(`${SHIFTS}/${first.id}/close`, { countedCash: '10' });
    clock = new Date('2026-10-13T15:00:00Z');
    const second = await openShift(cashier, '20');

    const manager = await asMallManager();
    const res = await manager.get(`${SHIFTS}?branchId=${world.mall.id}`);
    expect(res.status).toBe(200);
    const rows = (res.body as { data: unknown[] }).data.map((row) => shiftSummarySchema.parse(row));
    expect(rows.map((row) => [row.id, row.status])).toEqual([
      [second.id, 'open'],
      [first.id, 'closed'],
    ]);

    expect((await cashier.get(`${SHIFTS}?branchId=${world.mall.id}`)).status).toBe(403);
    expect(
      (await (await asBurgerManager()).get(`${SHIFTS}?branchId=${world.mall.id}`)).status,
    ).toBe(404);
    expect((await (await asBurgerManager()).get(`${SHIFTS}/${second.id}`)).status).toBe(404);
  });
});
