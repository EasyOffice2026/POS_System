import { randomUUID } from 'node:crypto';
import { MAX_ORDER_LINES, type Order, orderSchema, orderSummarySchema } from '@pos/shared';
import type request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { createItem } from '../../../test/factories';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { createMenuWorld, type MenuWorld } from '../../../test/menu-world';
import { as, errorOf, signIn } from '../../../test/users-world';
import { createMemoryMenuCache } from '../../lib/menu-cache';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const cache = createMemoryMenuCache();
// 12:00 on Monday 12 October 2026 in Riyadh, the time zone of the test branches.
let clock = new Date('2026-10-12T09:00:00Z');
const app = createApp({
  prisma,
  config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }),
  menuCache: cache,
  now: () => clock,
});

// The manager of Pizza Mall approves on the terminal with this staff code and PIN.
const MANAGER = { staffCode: '2001', pin: '7351' };

let world: MenuWorld;

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  clock = new Date('2026-10-12T09:00:00Z');
  await resetDatabase(prisma);
  world = await createMenuWorld(prisma, hasher);
  await prisma.user.update({
    where: { id: world.users.mallManager.id },
    data: { staffCode: MANAGER.staffCode, pinHash: await hasher.hash(MANAGER.pin) },
  });
  // The tests here follow spec 005: a void needs a manager once something was sent.
  await prisma.brand.update({
    where: { id: world.pizza.id },
    data: { settings: { voidNeedsManager: 'after_send' } },
  });
});

type Api = ReturnType<typeof as>;
const ORDERS = '/api/v1/orders';
const asCashier = async () => as(app, await signIn(app, 'cashier@x.io'));
const asMallManager = async () => as(app, await signIn(app, 'mall-manager@x.io'));
const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));
const asBurgerManager = async () => as(app, await signIn(app, 'burger@x.io'));

const orderOf = (res: request.Response): Order => orderSchema.parse(res.body);
const dataOf = (res: request.Response) => (res.body as { data: unknown[] }).data;
const codesOf = (res: request.Response) => errorOf(res).details?.map((detail) => detail.message);

async function openOrder(api: Api, body: object = {}): Promise<Order> {
  const res = await api.post(ORDERS, { branchId: world.mall.id, type: 'takeaway', ...body });
  expect(res.status).toBe(201);
  return orderOf(res);
}

const addItem = (api: Api, orderId: string, itemId: string, extra: object = {}) =>
  api.post(`${ORDERS}/${orderId}/lines`, { kind: 'item', itemId, ...extra });

async function addedLine(api: Api, orderId: string, itemId: string, extra: object = {}) {
  const res = await addItem(api, orderId, itemId, extra);
  expect(res.status).toBe(200);
  const order = orderOf(res);
  const line = order.lines.at(-1);
  if (!line) throw new Error('The order has no line');
  return { order, line };
}

const auditRows = (action: string) =>
  prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });

async function setOverride(
  itemId: string,
  data: { priceOverride?: string; isAvailable?: boolean },
) {
  await prisma.branchMenuItem.create({
    data: { itemId, branchId: world.mall.id, brandId: world.pizza.id, ...data },
  });
  await cache.invalidate(world.pizza.id, world.mall.id);
}

describe('POST /orders', () => {
  it('opens an order with the next number of the day at the branch', async () => {
    const api = await asCashier();
    const first = await openOrder(api, { type: 'dine_in', note: 'Window seat' });
    expect(first).toMatchObject({
      branchId: world.mall.id,
      brandId: world.pizza.id,
      businessDate: '2026-10-12',
      number: 1,
      type: 'dine_in',
      status: 'open',
      note: 'Window seat',
      subtotal: '0.000',
      discount: null,
      total: '0.000',
      openedById: world.users.cashier.id,
      lines: [],
    });
    expect((await openOrder(api)).number).toBe(2);
  });

  it('counts each branch on its own, and starts again on the next day of the branch', async () => {
    const manager = await asPizzaManager();
    await openOrder(manager);
    expect((await openOrder(manager, { branchId: world.downtown.id })).number).toBe(1);

    // 00:30 on Tuesday in Riyadh, still Monday in UTC.
    clock = new Date('2026-10-12T21:30:00Z');
    const next = await openOrder(manager);
    expect(next).toMatchObject({ businessDate: '2026-10-13', number: 1 });
  });

  it('gives two orders opened at the same moment two numbers (criterion 3)', async ({ skip }) => {
    // The PostgreSQL of "prisma dev" runs in WebAssembly as one session for every connection, so
    // requests at the same moment get mixed up there. CI runs a real server.
    const rows: { version: string }[] = await prisma.$queryRaw`SELECT version()`;
    if (rows[0]?.version.includes('wasm')) skip('needs a real PostgreSQL server');

    const api = await asCashier();
    const opened = await Promise.all(Array.from({ length: 8 }, () => openOrder(api)));
    const numbers = opened.map((order) => order.number).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('gives back the same order when its id is sent twice (criterion 7)', async () => {
    const api = await asCashier();
    const id = randomUUID();
    const first = await openOrder(api, { id });

    const again = await api.post(ORDERS, { id, branchId: world.mall.id, type: 'takeaway' });
    expect(again.status).toBe(200);
    expect(orderOf(again)).toEqual(first);
    expect(await prisma.order.count()).toBe(1);

    const elsewhere = await (
      await asPizzaManager()
    ).post(ORDERS, { id, branchId: world.downtown.id, type: 'takeaway' });
    expect(elsewhere.status).toBe(409);
    expect(errorOf(elsewhere).code).toBe('ORDER_ID_TAKEN');
  });

  it('answers 409 for an id used by another brand, without showing that order', async () => {
    const pizza = await asCashier();
    const order = await openOrder(pizza);
    const { line } = await addedLine(pizza, order.id, world.items.cola.id, { id: randomUUID() });

    const burger = await asBurgerManager();
    const taken = await burger.post(ORDERS, {
      id: order.id,
      branchId: world.airport.id,
      type: 'takeaway',
    });
    expect(taken.status).toBe(409);
    expect(errorOf(taken).code).toBe('ORDER_ID_TAKEN');

    const own = orderOf(await burger.post(ORDERS, { branchId: world.airport.id, type: 'dine_in' }));
    const lineTaken = await addItem(burger, own.id, world.items.cheeseburger.id, { id: line.id });
    expect(lineTaken.status).toBe(409);
    expect(errorOf(lineTaken).code).toBe('LINE_ID_TAKEN');
  });

  it('refuses a branch the person does not work at, and a branch that is switched off', async () => {
    const api = await asCashier();
    const other = await api.post(ORDERS, { branchId: world.downtown.id, type: 'takeaway' });
    expect(other.status).toBe(404);

    await prisma.branch.update({ where: { id: world.mall.id }, data: { isActive: false } });
    const off = await api.post(ORDERS, { branchId: world.mall.id, type: 'takeaway' });
    expect(off.status).toBe(403);
    expect(errorOf(off).code).toBe('BRANCH_INACTIVE');
  });

  it('checks the request', async () => {
    const api = await asCashier();
    const res = await api.post(ORDERS, { type: 'drive_through' });
    expect(res.status).toBe(400);
    expect(codesOf(res)).toEqual(expect.arrayContaining(['BRANCH_REQUIRED', 'ORDER_TYPE_INVALID']));
  });
});

describe('GET /orders', () => {
  it('lists the orders newest first, with the number of lines that count', async () => {
    const api = await asCashier();
    const older = await openOrder(api);
    await addedLine(api, older.id, world.items.cola.id);
    await addedLine(api, older.id, world.items.margherita.id);
    const newer = await openOrder(api);
    await api.post(`${ORDERS}/${newer.id}/void`, { reason: 'Customer left' });

    const res = await api.get(`${ORDERS}?branchId=${world.mall.id}`);
    expect(res.status).toBe(200);
    const rows = dataOf(res).map((row) => orderSummarySchema.parse(row));
    expect(rows.map((row) => [row.number, row.status, row.lineCount])).toEqual([
      [2, 'voided', 0],
      [1, 'open', 2],
    ]);

    const open = await api.get(`${ORDERS}?status=open&businessDate=2026-10-12`);
    expect(dataOf(open).map((row) => orderSummarySchema.parse(row).id)).toEqual([older.id]);
    const otherDay = await api.get(`${ORDERS}?businessDate=2026-10-11`);
    expect(dataOf(otherDay)).toEqual([]);
  });

  it('shows a person only the orders of their own brand and branches', async () => {
    const order = await openOrder(await asCashier());
    await openOrder(await asPizzaManager(), { branchId: world.downtown.id });

    const cashier = await asCashier();
    expect(dataOf(await cashier.get(ORDERS))).toHaveLength(1);
    expect(dataOf(await (await asPizzaManager()).get(ORDERS))).toHaveLength(2);

    const burger = await asBurgerManager();
    expect(dataOf(await burger.get(ORDERS))).toEqual([]);
    expect((await burger.get(`${ORDERS}/${order.id}`)).status).toBe(404);
    expect((await burger.post(`${ORDERS}/${order.id}/send`)).status).toBe(404);
  });
});

describe('PATCH /orders/:id', () => {
  it('changes the type and the note', async () => {
    const api = await asCashier();
    const order = await openOrder(api, { note: 'Old' });
    const res = await api.patch(`${ORDERS}/${order.id}`, { type: 'dine_in', note: null });
    expect(res.status).toBe(200);
    expect(orderOf(res)).toMatchObject({ type: 'dine_in', note: null });
  });
});

describe('POST /orders/:id/lines', () => {
  it('copies the branch price, which stays after the menu changes (criterion 1)', async () => {
    await setOverride(world.items.margherita.id, { priceOverride: '22.500' });
    const api = await asCashier();
    const order = await openOrder(api);

    const { order: after, line } = await addedLine(api, order.id, world.items.margherita.id, {
      quantity: 2,
      note: 'Well done',
    });
    expect(line).toMatchObject({
      kind: 'item',
      itemId: world.items.margherita.id,
      comboId: null,
      name: { en: 'Margherita', ar: 'Margherita (ar)' },
      unitPrice: '22.500',
      quantity: 2,
      lineTotal: '45.000',
      note: 'Well done',
      status: 'pending',
    });
    expect(after).toMatchObject({ subtotal: '45.000', total: '45.000' });

    await prisma.menuItem.update({
      where: { id: world.items.margherita.id },
      data: { basePrice: '25.000' },
    });
    await prisma.branchMenuItem.updateMany({ data: { priceOverride: '26.000' } });
    await cache.invalidate(world.pizza.id, world.mall.id);

    const again = orderOf(await api.get(`${ORDERS}/${order.id}`));
    expect(again.lines[0]).toMatchObject({ unitPrice: '22.500', lineTotal: '45.000' });
  });

  it('asks for a required size (criterion 2) and adds the price of the chosen one', async () => {
    const group = await prisma.modifierGroup.create({
      data: {
        brandId: world.pizza.id,
        itemId: world.items.pepperoni.id,
        name: { en: 'Size', ar: 'الحجم' },
        minSelect: 1,
        maxSelect: 1,
      },
    });
    const large = await prisma.modifier.create({
      data: {
        brandId: world.pizza.id,
        groupId: group.id,
        name: { en: 'Large', ar: 'كبير' },
        priceDelta: '4.000',
      },
    });
    const api = await asCashier();
    const order = await openOrder(api);

    const missing = await addItem(api, order.id, world.items.pepperoni.id);
    expect(missing.status).toBe(400);
    expect(errorOf(missing).code).toBe('VALIDATION_ERROR');
    expect(errorOf(missing).details).toEqual([
      { path: `modifiers.${group.id}`, message: 'MODIFIER_CHOICE_MISSING' },
    ]);

    const { line } = await addedLine(api, order.id, world.items.pepperoni.id, {
      modifierIds: [large.id],
    });
    expect(line).toMatchObject({ unitPrice: '28.000', lineTotal: '28.000' });
    expect(line.modifiers).toEqual([
      { id: large.id, groupId: group.id, name: { en: 'Large', ar: 'كبير' }, priceDelta: '4.000' },
    ]);
  });

  it('refuses a dish switched off at the branch (criterion 6), or of another brand', async () => {
    await setOverride(world.items.cola.id, { isAvailable: false });
    const api = await asCashier();
    const order = await openOrder(api);

    const off = await addItem(api, order.id, world.items.cola.id);
    expect(off.status).toBe(400);
    expect(codesOf(off)).toEqual(['ITEM_NOT_AVAILABLE']);

    const burger = await addItem(api, order.id, world.items.cheeseburger.id);
    expect(codesOf(burger)).toEqual(['ITEM_NOT_AVAILABLE']);
  });

  it('adds a combo with a choice for each slot', async () => {
    const combo = await prisma.combo.create({
      data: { brandId: world.pizza.id, name: { en: 'Meal', ar: 'وجبة' }, price: '24.000' },
    });
    const main = await prisma.comboSlot.create({
      data: { brandId: world.pizza.id, comboId: combo.id, name: { en: 'Main', ar: 'رئيسي' } },
    });
    const drink = await prisma.comboSlot.create({
      data: { brandId: world.pizza.id, comboId: combo.id, name: { en: 'Drink', ar: 'مشروب' } },
    });
    await prisma.comboSlotOption.createMany({
      data: [
        { slotId: main.id, itemId: world.items.margherita.id, brandId: world.pizza.id },
        {
          slotId: drink.id,
          itemId: world.items.cola.id,
          brandId: world.pizza.id,
          priceDelta: '1.000',
        },
      ],
    });
    const api = await asCashier();
    const order = await openOrder(api);

    const res = await api.post(`${ORDERS}/${order.id}/lines`, {
      kind: 'combo',
      comboId: combo.id,
      choices: [
        { slotId: main.id, itemId: world.items.margherita.id },
        { slotId: drink.id, itemId: world.items.cola.id },
      ],
    });
    expect(res.status).toBe(200);
    const [line] = orderOf(res).lines;
    expect(line).toMatchObject({ kind: 'combo', comboId: combo.id, unitPrice: '25.000' });
    expect(line?.choices.map((choice) => [choice.slotName.en, choice.name.en])).toEqual([
      ['Main', 'Margherita'],
      ['Drink', 'Cola'],
    ]);
  });

  it('adds a line sent twice with the same id once', async () => {
    const api = await asCashier();
    const order = await openOrder(api);
    const id = randomUUID();
    await addedLine(api, order.id, world.items.cola.id, { id });
    const { order: again } = await addedLine(api, order.id, world.items.cola.id, { id });
    expect(again.lines.map((line) => line.id)).toEqual([id]);
    expect(again.total).toBe('5.000');

    const other = await openOrder(api);
    const taken = await addItem(api, other.id, world.items.cola.id, { id });
    expect(taken.status).toBe(409);
    expect(errorOf(taken).code).toBe('LINE_ID_TAKEN');
  });

  it(`stops at ${MAX_ORDER_LINES} lines`, async () => {
    const api = await asCashier();
    const order = await openOrder(api);
    await prisma.orderLine.createMany({
      data: Array.from({ length: MAX_ORDER_LINES }, (_, position) => ({
        orderId: order.id,
        brandId: world.pizza.id,
        branchId: world.mall.id,
        kind: 'item' as const,
        itemId: world.items.cola.id,
        name: { en: 'Cola', ar: 'Cola (ar)' },
        unitPrice: '5.000',
        quantity: 1,
        lineTotal: '5.000',
        position,
      })),
    });
    const res = await addItem(api, order.id, world.items.cola.id);
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('ORDER_FULL');
  });

  it('refuses a line on a switched-off branch', async () => {
    const api = await asCashier();
    const order = await openOrder(api);
    await prisma.branch.update({ where: { id: world.mall.id }, data: { isActive: false } });
    const res = await addItem(api, order.id, world.items.cola.id);
    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe('BRANCH_INACTIVE');
  });
});

describe('changing, removing and sending lines', () => {
  it('changes and removes a line until it is sent, then only voids it', async () => {
    const api = await asCashier();
    const order = await openOrder(api);
    const { line: cola } = await addedLine(api, order.id, world.items.cola.id);
    const { line: pizza } = await addedLine(api, order.id, world.items.margherita.id);

    const changed = await api.patch(`${ORDERS}/${order.id}/lines/${cola.id}`, { quantity: 3 });
    expect(changed.status).toBe(200);
    expect(orderOf(changed)).toMatchObject({ subtotal: '35.000', total: '35.000' });

    const removed = await api.delete(`${ORDERS}/${order.id}/lines/${pizza.id}`);
    expect(orderOf(removed).lines.map((line) => line.id)).toEqual([cola.id]);
    expect(orderOf(removed).total).toBe('15.000');

    const sent = orderOf(await api.post(`${ORDERS}/${order.id}/send`));
    expect(sent.lines[0]).toMatchObject({ status: 'sent', sentAt: clock.toISOString() });

    const change = await api.patch(`${ORDERS}/${order.id}/lines/${cola.id}`, { quantity: 1 });
    expect(change.status).toBe(409);
    expect(errorOf(change).code).toBe('LINE_ALREADY_SENT');
    const remove = await api.delete(`${ORDERS}/${order.id}/lines/${cola.id}`);
    expect(errorOf(remove).code).toBe('LINE_ALREADY_SENT');

    const nothing = await api.post(`${ORDERS}/${order.id}/send`);
    expect(nothing.status).toBe(409);
    expect(errorOf(nothing).code).toBe('NOTHING_TO_SEND');
  });

  it('answers 404 for a line of another order', async () => {
    const api = await asCashier();
    const first = await openOrder(api);
    const { line } = await addedLine(api, first.id, world.items.cola.id);
    const second = await openOrder(api);
    const res = await api.patch(`${ORDERS}/${second.id}/lines/${line.id}`, { quantity: 2 });
    expect(res.status).toBe(404);
  });
});

describe('POST /orders/:id/lines/:lineId/void', () => {
  async function sentLine(api: Api) {
    const order = await openOrder(api);
    await addedLine(api, order.id, world.items.cola.id);
    const { line } = await addedLine(api, order.id, world.items.margherita.id);
    await api.post(`${ORDERS}/${order.id}/send`);
    return { order, line, path: `${ORDERS}/${order.id}/lines/${line.id}/void` };
  }

  it('needs a manager for a cashier, and the audit log names them (criterion 4)', async () => {
    const api = await asCashier();
    const { path } = await sentLine(api);

    const refused = await api.post(path, { reason: 'Customer changed mind' });
    expect(refused.status).toBe(400);
    expect(errorOf(refused).details).toEqual([{ path: 'approval', message: 'APPROVAL_REQUIRED' }]);

    const res = await api.post(path, { reason: 'Customer changed mind', approval: MANAGER });
    expect(res.status).toBe(200);
    const order = orderOf(res);
    expect(order.lines[1]).toMatchObject({
      status: 'voided',
      voidedAt: clock.toISOString(),
      voidReason: 'Customer changed mind',
    });
    expect(order).toMatchObject({ subtotal: '5.000', total: '5.000' });

    const [row] = await auditRows('order.line_voided');
    expect(row).toMatchObject({
      userId: world.users.cashier.id,
      brandId: world.pizza.id,
      branchId: world.mall.id,
      entityId: order.id,
    });
    expect(row?.metadata).toMatchObject({
      number: 1,
      reason: 'Customer changed mind',
      lineTotal: '20.000',
      approvedById: world.users.mallManager.id,
    });

    const twice = await api.post(path, { reason: 'Again', approval: MANAGER });
    expect(errorOf(twice).code).toBe('LINE_VOIDED');
  });

  it('lets a manager void without a PIN', async () => {
    const { path } = await sentLine(await asCashier());
    const res = await (await asMallManager()).post(path, { reason: 'Burnt' });
    expect(res.status).toBe(200);
    const [row] = await auditRows('order.line_voided');
    expect(row?.metadata).toMatchObject({ approvedById: null });
  });

  it('refuses a wrong PIN, a cashier as approver, and a pending line', async () => {
    const api = await asCashier();
    const { order, path } = await sentLine(api);

    const wrong = await api.post(path, {
      reason: 'x',
      approval: { staffCode: MANAGER.staffCode, pin: '0000' },
    });
    expect(errorOf(wrong).details).toEqual([{ path: 'approval', message: 'APPROVAL_INVALID' }]);
    const unknown = await api.post(path, {
      reason: 'x',
      approval: { staffCode: '9999', pin: '1' },
    });
    expect(errorOf(unknown).details).toEqual([{ path: 'approval', message: 'APPROVAL_INVALID' }]);
    const cashier = await api.post(path, {
      reason: 'x',
      approval: { staffCode: '1001', pin: '4829' },
    });
    expect(errorOf(cashier).details).toEqual([
      { path: 'approval', message: 'APPROVAL_NOT_ALLOWED' },
    ]);

    const { line: pending } = await addedLine(api, order.id, world.items.cola.id);
    const notSent = await api.post(`${ORDERS}/${order.id}/lines/${pending.id}/void`, {
      reason: 'x',
      approval: MANAGER,
    });
    expect(notSent.status).toBe(409);
    expect(errorOf(notSent).code).toBe('LINE_NOT_SENT');
  });

  it('locks a manager PIN after five wrong tries, like a sign-in', async () => {
    const api = await asCashier();
    const { path } = await sentLine(api);
    const wrong = { staffCode: MANAGER.staffCode, pin: '0000' };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await api.post(path, { reason: 'x', approval: wrong });
    }
    const locked = await api.post(path, { reason: 'x', approval: MANAGER });
    expect(errorOf(locked).details).toEqual([{ path: 'approval', message: 'APPROVAL_LOCKED' }]);
    expect(await auditRows('auth.login.locked')).toHaveLength(1);
    const failed = await auditRows('auth.login.failed');
    expect(failed).toHaveLength(5);
    expect(failed[0]?.metadata).toMatchObject({ type: 'approval' });
  });
});

describe('POST /orders/:id/void', () => {
  it('lets a cashier cancel an order while nothing was sent', async () => {
    const api = await asCashier();
    const order = await openOrder(api);
    await addedLine(api, order.id, world.items.cola.id);

    const res = await api.post(`${ORDERS}/${order.id}/void`, { reason: 'Customer left' });
    expect(res.status).toBe(200);
    expect(orderOf(res)).toMatchObject({ status: 'voided', voidReason: 'Customer left' });
    const [row] = await auditRows('order.voided');
    expect(row?.metadata).toMatchObject({ sentLines: 0, approvedById: null, total: '5.000' });

    const closed = await addItem(api, order.id, world.items.cola.id);
    expect(closed.status).toBe(409);
    expect(errorOf(closed).code).toBe('ORDER_NOT_OPEN');
    const again = await api.post(`${ORDERS}/${order.id}/void`, { reason: 'Again' });
    expect(errorOf(again).code).toBe('ORDER_NOT_OPEN');
  });

  it('needs a manager once a line was sent', async () => {
    const api = await asCashier();
    const order = await openOrder(api);
    await addedLine(api, order.id, world.items.cola.id);
    await api.post(`${ORDERS}/${order.id}/send`);

    const refused = await api.post(`${ORDERS}/${order.id}/void`, { reason: 'Customer left' });
    expect(errorOf(refused).details).toEqual([{ path: 'approval', message: 'APPROVAL_REQUIRED' }]);

    const res = await api.post(`${ORDERS}/${order.id}/void`, {
      reason: 'Customer left',
      approval: MANAGER,
    });
    expect(orderOf(res).status).toBe('voided');
    const [row] = await auditRows('order.voided');
    expect(row?.metadata).toMatchObject({
      sentLines: 1,
      approvedById: world.users.mallManager.id,
    });
  });

  it('needs a reason', async () => {
    const api = await asCashier();
    const order = await openOrder(api);
    const res = await api.post(`${ORDERS}/${order.id}/void`, {});
    expect(codesOf(res)).toEqual(['REASON_REQUIRED']);
  });
});

describe('discounts', () => {
  async function orderOfFifty(api: Api) {
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
    const order = await openOrder(api);
    await addedLine(api, order.id, fifty.id);
    return { order, thirty };
  }

  it('works a percentage out again when a line is added (criterion 5)', async () => {
    const api = await asMallManager();
    const { order, thirty } = await orderOfFifty(api);

    const set = await api.put(`${ORDERS}/${order.id}/discount`, {
      kind: 'percent',
      value: '10',
      reason: 'Regular customer',
    });
    expect(set.status).toBe(200);
    expect(orderOf(set)).toMatchObject({
      subtotal: '50.000',
      discount: { kind: 'percent', value: '10.00', amount: '5.000', reason: 'Regular customer' },
      total: '45.000',
    });

    const { order: after } = await addedLine(api, order.id, thirty.id);
    expect(after).toMatchObject({
      subtotal: '80.000',
      discount: { amount: '8.000' },
      total: '72.000',
    });

    const [row] = await auditRows('order.discount_set');
    expect(row?.metadata).toMatchObject({ kind: 'percent', value: '10.00', approvedById: null });
  });

  it('keeps an amount within the subtotal, and removes it', async () => {
    const api = await asMallManager();
    const { order } = await orderOfFifty(api);

    const set = await api.put(`${ORDERS}/${order.id}/discount`, {
      kind: 'amount',
      value: '60',
      reason: 'Complaint',
    });
    expect(orderOf(set)).toMatchObject({
      discount: { kind: 'amount', value: '60.000', amount: '50.000' },
      total: '0.000',
    });

    const removed = await api.delete(`${ORDERS}/${order.id}/discount`);
    expect(removed.status).toBe(200);
    expect(orderOf(removed)).toMatchObject({ discount: null, total: '50.000' });
    expect(await auditRows('order.discount_removed')).toHaveLength(1);

    // Removing it again changes nothing and records nothing.
    await api.delete(`${ORDERS}/${order.id}/discount`);
    expect(await auditRows('order.discount_removed')).toHaveLength(1);
  });

  it('needs a manager for a cashier', async () => {
    const api = await asCashier();
    const { order } = await orderOfFifty(api);
    const body = { kind: 'percent', value: '10', reason: 'Regular customer' };

    const refused = await api.put(`${ORDERS}/${order.id}/discount`, body);
    expect(errorOf(refused).details).toEqual([{ path: 'approval', message: 'APPROVAL_REQUIRED' }]);

    const res = await api.put(`${ORDERS}/${order.id}/discount`, { ...body, approval: MANAGER });
    expect(orderOf(res).total).toBe('45.000');
    const [row] = await auditRows('order.discount_set');
    expect(row?.metadata).toMatchObject({ approvedById: world.users.mallManager.id });

    const remove = await api.delete(`${ORDERS}/${order.id}/discount`, {});
    expect(errorOf(remove).details).toEqual([{ path: 'approval', message: 'APPROVAL_REQUIRED' }]);
  });

  it('refuses a percentage above 100', async () => {
    const api = await asMallManager();
    const { order } = await orderOfFifty(api);
    const res = await api.put(`${ORDERS}/${order.id}/discount`, {
      kind: 'percent',
      value: '101',
      reason: 'x',
    });
    expect(codesOf(res)).toEqual(['DISCOUNT_VALUE_INVALID']);
  });
});

// Order types per branch and delivery (docs/specs/026-order-types.md).
describe('order types and delivery', () => {
  const details = { name: 'Noor', phone: '+965 5555 1234', address: 'Block 4, Street 12, House 7' };

  async function offer(types: { dine_in: boolean; takeaway: boolean; delivery: boolean }) {
    const branch = await prisma.branch.findUniqueOrThrow({ where: { id: world.mall.id } });
    await prisma.branch.update({
      where: { id: world.mall.id },
      data: { config: { ...(branch.config as object), orderTypes: types } },
    });
  }

  it('offers Dine-in and Takeaway until the branch changes it', async () => {
    const api = await asCashier();
    const menu = await api.get(`/api/v1/menu?branchId=${world.mall.id}`);
    expect((menu.body as { orderTypes: string[] }).orderTypes).toEqual(['dine_in', 'takeaway']);

    const refused = await api.post(ORDERS, { branchId: world.mall.id, type: 'delivery' });
    expect(refused.status).toBe(409);
    expect(errorOf(refused).code).toBe('ORDER_TYPE_NOT_OFFERED');
  });

  it('refuses a type that is off, when opening an order and when changing its type', async () => {
    await offer({ dine_in: false, takeaway: true, delivery: true });
    const api = await asCashier();

    const opened = await api.post(ORDERS, { branchId: world.mall.id, type: 'dine_in' });
    expect(errorOf(opened).code).toBe('ORDER_TYPE_NOT_OFFERED');

    const order = await openOrder(api);
    const changed = await api.patch(`${ORDERS}/${order.id}`, { type: 'dine_in' });
    expect(errorOf(changed).code).toBe('ORDER_TYPE_NOT_OFFERED');

    const menu = await api.get(`/api/v1/menu?branchId=${world.mall.id}`);
    expect((menu.body as { orderTypes: string[] }).orderTypes).toEqual(['takeaway', 'delivery']);
  });

  it('keeps an open order of a type that was switched off since', async () => {
    const api = await asCashier();
    const order = await openOrder(api, { type: 'dine_in' });
    await offer({ dine_in: false, takeaway: true, delivery: false });
    await addedLine(api, order.id, world.items.cola.id);
    const sent = await api.post(`${ORDERS}/${order.id}/send`);
    expect(orderOf(sent).type).toBe('dine_in');
  });

  it('takes a delivery order with its phone and address, and prints them on the order', async () => {
    await offer({ dine_in: true, takeaway: true, delivery: true });
    const api = await asCashier();
    const order = await openOrder(api, { type: 'delivery' });
    expect(order.delivery).toBeNull();
    await addedLine(api, order.id, world.items.cola.id);

    // Not sent, nor paid, without the details.
    const early = await api.post(`${ORDERS}/${order.id}/send`);
    expect(early.status).toBe(409);
    expect(errorOf(early).code).toBe('DELIVERY_DETAILS_REQUIRED');
    const unpaid = await api.post(`${ORDERS}/${order.id}/pay`, { tenders: [] });
    expect(errorOf(unpaid).code).toBe('DELIVERY_DETAILS_REQUIRED');

    const set = await api.patch(`${ORDERS}/${order.id}`, {
      delivery: { ...details, note: ' Ring twice ' },
    });
    expect(set.status).toBe(200);
    expect(orderOf(set).delivery).toEqual({ ...details, note: 'Ring twice' });

    const sent = await api.post(`${ORDERS}/${order.id}/send`);
    expect(sent.status).toBe(200);
    expect(orderOf(sent).delivery?.address).toBe(details.address);
  });

  it('needs a phone and an address, and only for a delivery order', async () => {
    await offer({ dine_in: true, takeaway: true, delivery: true });
    const api = await asCashier();
    const order = await openOrder(api, { type: 'delivery' });

    const noAddress = await api.patch(`${ORDERS}/${order.id}`, {
      delivery: { phone: '55551234', address: ' ' },
    });
    expect(noAddress.status).toBe(400);
    expect(codesOf(noAddress)).toContain('DELIVERY_ADDRESS_REQUIRED');

    const badPhone = await api.patch(`${ORDERS}/${order.id}`, {
      delivery: { phone: 'abc', address: 'Block 1' },
    });
    expect(codesOf(badPhone)).toContain('DELIVERY_PHONE_INVALID');

    const takeaway = await openOrder(api);
    const wrong = await api.patch(`${ORDERS}/${takeaway.id}`, { delivery: details });
    expect(errorOf(wrong).code).toBe('DELIVERY_NOT_APPLICABLE');
  });

  it('opens a delivery order with its details, and drops them when the type changes', async () => {
    await offer({ dine_in: true, takeaway: true, delivery: true });
    const api = await asCashier();
    const order = await openOrder(api, { type: 'delivery', delivery: details });
    expect(order.delivery).toMatchObject({ phone: details.phone, note: null });

    const changed = await api.patch(`${ORDERS}/${order.id}`, { type: 'takeaway' });
    expect(orderOf(changed)).toMatchObject({ type: 'takeaway', delivery: null });
  });
});
