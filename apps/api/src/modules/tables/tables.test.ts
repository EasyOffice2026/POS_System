import { randomUUID } from 'node:crypto';
import {
  diningTableListSchema,
  type DiningTable,
  floorSchema,
  kitchenTicketListSchema,
  type Order,
  orderSchema,
  type TableRequest,
} from '@pos/shared';
import type request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { openShift } from '../../../test/factories';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { createMenuWorld, type MenuWorld } from '../../../test/menu-world';
import { as, errorOf, signIn } from '../../../test/users-world';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const app = createApp({ prisma, config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }) });

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
const tablesUrl = () => `/api/v1/branches/${world.mall.id}/tables`;
const floorUrl = () => `/api/v1/branches/${world.mall.id}/floor`;
const asCashier = async () => as(app, await signIn(app, 'cashier@x.io'));
const asMallManager = async () => as(app, await signIn(app, 'mall-manager@x.io'));

const orderOf = (res: request.Response): Order => orderSchema.parse(res.body);
const tablesOf = (res: request.Response) => diningTableListSchema.parse(res.body).data;
const messagesOf = (res: request.Response) =>
  (errorOf(res).details ?? []).map((detail) => `${detail.path}:${detail.message}`);

const plan = (overrides: Partial<TableRequest> = {}) => ({
  name: '1',
  area: 'Inside',
  seats: 4,
  shape: 'square',
  x: 0,
  y: 0,
  width: 2,
  height: 2,
  isActive: true,
  ...overrides,
});

// Tables 1 and 2 inside, and 7 on the terrace (criterion 1).
async function threeTables(api: Api) {
  const res = await api.put(tablesUrl(), {
    tables: [
      plan(),
      plan({ name: '2', x: 2 }),
      plan({ name: '7', area: 'Terrace', shape: 'round', seats: 6 }),
    ],
  });
  expect(res.status).toBe(200);
  const tables = tablesOf(res);
  const named = (name: string) => tables.find((table) => table.name === name) as DiningTable;
  return { tables, one: named('1'), two: named('2'), seven: named('7') };
}

// A table as the plan sends it back.
const keep = ({ branchId: _branchId, ...table }: DiningTable) => table;

async function floor(api: Api) {
  return floorSchema.parse((await api.get(floorUrl())).body).data;
}

async function orderAt(api: Api, tableId: string) {
  const res = await api.post(ORDERS, { branchId: world.mall.id, type: 'takeaway', tableId });
  expect(res.status).toBe(201);
  return orderOf(res);
}

describe('the floor plan of a branch', () => {
  it('is saved by the branch manager and shown on the floor, free (criterion 1)', async () => {
    const manager = await asMallManager();
    const { tables } = await threeTables(manager);
    expect(tables.map((table) => [table.area, table.name, table.seats, table.shape])).toEqual([
      ['Inside', '1', 4, 'square'],
      ['Inside', '2', 4, 'square'],
      ['Terrace', '7', 6, 'round'],
    ]);
    const cashier = await asCashier();
    expect((await floor(cashier)).map((table) => [table.name, table.order])).toEqual([
      ['1', null],
      ['2', null],
      ['7', null],
    ]);
    await expect(
      prisma.auditLog.count({ where: { action: 'branch.tables_updated' } }),
    ).resolves.toBe(1);
  });

  it('refuses overlaps, tables outside the grid and names used twice (criterion 2)', async () => {
    const manager = await asMallManager();
    const res = await manager.put(tablesUrl(), {
      tables: [
        plan(),
        plan({ name: '2', x: 1 }),
        plan({ name: 't1', x: 23 }),
        plan({ name: 'T1', area: 'Bar' }),
      ],
    });
    expect(messagesOf(res)).toEqual([
      'tables.1:TABLE_OVERLAP',
      'tables.2.x:TABLE_OUTSIDE',
      'tables.3.name:TABLE_NAME_TAKEN',
    ]);
    await expect(prisma.diningTable.count()).resolves.toBe(0);
  });

  it('renames, swaps and removes tables, and keeps a used one out of use (criterion 6)', async () => {
    const manager = await asMallManager();
    const { one, two, seven } = await threeTables(manager);
    const cashier = await asCashier();
    const order = await orderAt(cashier, seven.id);

    // A table with an open order stays in use.
    const busy = await manager.put(tablesUrl(), { tables: [keep(one), keep(two)] });
    expect(busy.status).toBe(409);
    expect(errorOf(busy).code).toBe('TABLE_IN_USE');
    const idle = await manager.put(tablesUrl(), {
      tables: [keep(one), keep(two), { ...keep(seven), isActive: false }],
    });
    expect(errorOf(idle).code).toBe('TABLE_IN_USE');

    // Paid, table 7 is left out: it is kept out of use; table 2 had no order and goes.
    await cashier.post(`${ORDERS}/${order.id}/lines`, {
      kind: 'item',
      itemId: world.items.cola.id,
      quantity: 1,
    });
    const due = orderOf(await cashier.get(`${ORDERS}/${order.id}`));
    await cashier.post(`${ORDERS}/${order.id}/pay`, {
      tenders: [{ id: randomUUID(), method: 'cash', amount: due.total, tendered: due.total }],
    });
    const saved = tablesOf(
      await manager.put(tablesUrl(), {
        tables: [{ ...keep(one), name: '2' }, plan({ name: '1', x: 4 })],
      }),
    );
    expect(saved.map((table) => [table.name, table.isActive, table.id === one.id])).toEqual([
      ['2', true, true],
      ['1', true, false],
      ['7', false, false],
    ]);
    await expect(prisma.diningTable.findUnique({ where: { id: two.id } })).resolves.toBeNull();
    expect((await floor(cashier)).map((table) => table.name)).toEqual(['2', '1']);

    // A new table cannot take the name kept by table 7.
    const clash = await manager.put(tablesUrl(), {
      tables: [
        ...saved.filter((table) => table.isActive).map(keep),
        plan({ name: '7', area: 'Bar' }),
      ],
    });
    expect(messagesOf(clash)).toEqual(['tables.2.name:TABLE_NAME_TAKEN']);
  });

  it('is changed only by those with the right, and never seen by another brand (criterion 7)', async () => {
    const manager = await asMallManager();
    await threeTables(manager);
    const cashier = await asCashier();
    expect((await cashier.get(tablesUrl())).status).toBe(403);
    expect((await cashier.put(tablesUrl(), { tables: [] })).status).toBe(403);
    expect((await floor(cashier)).length).toBe(3);

    const burger = as(app, await signIn(app, 'burger@x.io'));
    expect((await burger.get(tablesUrl())).status).toBe(404);
    expect((await burger.get(floorUrl())).status).toBe(404);
    expect((await burger.put(tablesUrl(), { tables: [] })).status).toBe(404);
    const pizza = as(app, await signIn(app, 'pizza@x.io'));
    expect(tablesOf(await pizza.get(tablesUrl())).length).toBe(3);
  });
});

describe('an order at a table', () => {
  it('is dine-in, shows on the floor, and keeps the table for itself (criterion 3)', async () => {
    const { seven } = await threeTables(await asMallManager());
    const cashier = await asCashier();
    const order = await orderAt(cashier, seven.id);
    expect(order).toMatchObject({
      type: 'dine_in',
      table: { id: seven.id, name: '7', area: 'Terrace' },
    });

    const tables = await floor(cashier);
    expect(tables.find((table) => table.id === seven.id)?.order).toMatchObject({
      id: order.id,
      number: order.number,
      total: '0.000',
      billPrintedAt: null,
    });
    const second = await cashier.post(ORDERS, {
      branchId: world.mall.id,
      type: 'dine_in',
      tableId: seven.id,
    });
    expect(second.status).toBe(409);
    expect(errorOf(second).code).toBe('TABLE_TAKEN');
    // Sent again with its own id, the same order comes back.
    const again = await cashier.post(ORDERS, {
      id: order.id,
      branchId: world.mall.id,
      type: 'dine_in',
      tableId: seven.id,
    });
    expect(again.status).toBe(200);

    const other = await cashier.post(ORDERS, {
      branchId: world.mall.id,
      type: 'dine_in',
      tableId: randomUUID(),
    });
    expect(messagesOf(other)).toEqual(['tableId:TABLE_NOT_FOUND']);
  });

  it('moves to a free table, leaves it when takeaway, and never to a taken one (criterion 4)', async () => {
    const { one, two, seven } = await threeTables(await asMallManager());
    const cashier = await asCashier();
    const order = await orderAt(cashier, seven.id);
    const blocker = await orderAt(cashier, one.id);

    const moved = orderOf(await cashier.put(`${ORDERS}/${order.id}/table`, { tableId: two.id }));
    expect(moved.table?.name).toBe('2');
    const tables = await floor(cashier);
    expect(tables.map((table) => [table.name, table.order?.id ?? null])).toEqual([
      ['1', blocker.id],
      ['2', order.id],
      ['7', null],
    ]);

    const taken = await cashier.put(`${ORDERS}/${order.id}/table`, { tableId: one.id });
    expect(errorOf(taken).code).toBe('TABLE_TAKEN');

    const takeaway = orderOf(await cashier.patch(`${ORDERS}/${order.id}`, { type: 'takeaway' }));
    expect(takeaway).toMatchObject({ type: 'takeaway', table: null });
    // Put at a table again, it is dine-in again.
    const back = orderOf(await cashier.put(`${ORDERS}/${order.id}/table`, { tableId: seven.id }));
    expect(back).toMatchObject({ type: 'dine_in', table: { name: '7' } });
    const off = orderOf(await cashier.delete(`${ORDERS}/${order.id}/table`));
    expect(off).toMatchObject({ type: 'dine_in', table: null });
  });

  it('waits to be paid once its bill is printed, until it changes; paid, it frees the table (criterion 5)', async () => {
    const { seven } = await threeTables(await asMallManager());
    const cashier = await asCashier();
    const order = await orderAt(cashier, seven.id);
    const empty = await cashier.post(`${ORDERS}/${order.id}/bill`);
    expect(errorOf(empty).code).toBe('ORDER_EMPTY');

    await cashier.post(`${ORDERS}/${order.id}/lines`, {
      kind: 'item',
      itemId: world.items.cola.id,
      quantity: 2,
    });
    const billed = orderOf(await cashier.post(`${ORDERS}/${order.id}/bill`));
    expect(billed.billPrintedAt).not.toBeNull();
    expect((await floor(cashier))[2]?.order?.billPrintedAt).toBe(billed.billPrintedAt);

    // Sent to the kitchen, nothing changes the total: the bill stays good.
    const sent = orderOf(await cashier.post(`${ORDERS}/${order.id}/send`));
    expect(sent.billPrintedAt).toBe(billed.billPrintedAt);
    const tickets = kitchenTicketListSchema.parse(
      (await cashier.get(`/api/v1/kitchen/tickets?branchId=${world.mall.id}`)).body,
    ).data;
    expect(tickets.map((ticket) => ticket.tableName)).toEqual(['7']);

    const more = orderOf(
      await cashier.post(`${ORDERS}/${order.id}/lines`, {
        kind: 'item',
        itemId: world.items.cola.id,
        quantity: 1,
      }),
    );
    expect(more.billPrintedAt).toBeNull();

    const paid = orderOf(
      await cashier.post(`${ORDERS}/${order.id}/pay`, {
        tenders: [{ id: randomUUID(), method: 'cash', amount: more.total, tendered: more.total }],
      }),
    );
    expect(paid).toMatchObject({ status: 'paid', table: { name: '7' } });
    expect((await floor(cashier))[2]?.order).toBeNull();
    // The table takes a new order.
    expect((await orderAt(cashier, seven.id)).table?.name).toBe('7');
  });

  it('frees its table when voided', async () => {
    const { seven } = await threeTables(await asMallManager());
    const manager = await asMallManager();
    const order = await orderAt(manager, seven.id);
    const voided = await manager.post(`${ORDERS}/${order.id}/void`, { reason: 'Left' });
    expect(voided.status).toBe(200);
    expect((await floor(manager))[2]?.order).toBeNull();
  });
});
