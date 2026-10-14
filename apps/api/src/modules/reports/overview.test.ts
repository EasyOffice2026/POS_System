import { randomUUID } from 'node:crypto';
import { type Overview, overviewSchema } from '@pos/shared';
import type request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { createMenuWorld, type MenuWorld } from '../../../test/menu-world';
import { as, signIn } from '../../../test/users-world';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

// Thursday 15 October 2026, 21:00 in Kuwait (UTC+3).
const NOW = new Date('2026-10-15T18:00:00.000Z');
const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const app = createApp({
  prisma,
  config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }),
  now: () => NOW,
});

let world: MenuWorld;
let number = 0;

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  world = await createMenuWorld(prisma, hasher);
  number = 0;
});

const OVERVIEW = '/api/v1/reports/overview';
const overviewOf = (res: request.Response): Overview => overviewSchema.parse(res.body);
const asAdmin = async () => as(app, await signIn(app, 'admin@x.io'));

// An order written straight to the database, with one line of a dish.
async function order(input: {
  branch?: { id: string; brandId: string };
  date?: string;
  status?: 'open' | 'paid' | 'voided';
  total: string;
  paidAt?: string;
  itemId?: string;
  quantity?: number;
  tableId?: string;
}) {
  const branch = input.branch ?? world.mall;
  const status = input.status ?? 'paid';
  number += 1;
  const row = await prisma.order.create({
    data: {
      brandId: branch.brandId,
      branchId: branch.id,
      businessDate: new Date(`${input.date ?? '2026-10-15'}T00:00:00Z`),
      number,
      type: input.tableId ? 'dine_in' : 'takeaway',
      status,
      subtotal: input.total,
      total: input.total,
      openedById: world.users.cashier.id,
      ...(input.tableId ? { tableId: input.tableId, tableOpenKey: input.tableId } : {}),
      ...(status === 'paid'
        ? {
            paidAt: new Date(input.paidAt ?? '2026-10-15T12:00:00Z'),
            paidById: world.users.cashier.id,
          }
        : {}),
      ...(status === 'voided'
        ? { voidedAt: NOW, voidedById: world.users.cashier.id, voidReason: 'Left' }
        : {}),
    },
  });
  const quantity = input.quantity ?? 1;
  await prisma.orderLine.create({
    data: {
      orderId: row.id,
      brandId: branch.brandId,
      branchId: branch.id,
      kind: 'item',
      itemId: input.itemId ?? world.items.cola.id,
      name: { en: 'x', ar: 'x' },
      unitPrice: (Number(input.total) / quantity).toFixed(3),
      quantity,
      lineTotal: input.total,
      status: 'sent',
      position: 0,
    },
  });
  return row;
}

describe("today's overview", () => {
  it('adds up the sales of every branch, by hour and by dish (criteria 1 and 5)', async () => {
    // 12:10 and 19:45 on the Mall's clock, 19:50 at Downtown.
    await order({
      total: '10.000',
      paidAt: '2026-10-15T09:10:00Z',
      itemId: world.items.margherita.id,
    });
    await order({ total: '20.000', paidAt: '2026-10-15T16:45:00Z', quantity: 4 });
    await order({ branch: world.downtown, total: '5.000', paidAt: '2026-10-15T16:50:00Z' });
    // Yesterday's sale is not today's.
    await order({ total: '99.000', date: '2026-10-14', paidAt: '2026-10-14T12:00:00Z' });

    const overview = overviewOf(await (await asAdmin()).get(OVERVIEW));
    expect(overview.summary).toMatchObject({
      sales: '35.000',
      orders: 3,
      averageOrder: '11.667',
      lastWeekSales: '0.000',
    });
    expect(
      overview.branches.map((branch) => [
        branch.name.en,
        branch.businessDate,
        branch.sales,
        branch.orders,
      ]),
    ).toEqual([
      ['Pizza Mall', '2026-10-15', '30.000', 2],
      ['Pizza Downtown', '2026-10-15', '5.000', 1],
      ['Burger Airport', '2026-10-15', '0.000', 0],
    ]);
    expect(overview.hours.filter((slot) => slot.orders > 0)).toEqual([
      { hour: 12, sales: '10.000', orders: 1 },
      { hour: 19, sales: '25.000', orders: 2 },
    ]);
    expect(overview.topItems.map((row) => [row.name.en, row.quantity, row.sales])).toEqual([
      ['Cola', 5, '25.000'],
      ['Margherita', 1, '10.000'],
    ]);
  });

  it('compares with last week up to the same moment (criterion 2)', async () => {
    await order({ total: '7.000', date: '2026-10-08', paidAt: '2026-10-08T10:00:00Z' });
    await order({ total: '9.000', date: '2026-10-08', paidAt: '2026-10-08T19:00:00Z' });
    const overview = overviewOf(await (await asAdmin()).get(OVERVIEW));
    expect(overview.summary).toMatchObject({ lastWeekSales: '7.000', lastWeekOrders: 1 });
    expect(overview.branches[0]?.lastWeekSales).toBe('7.000');
  });

  it('shows the open orders and the tables in use (criterion 3)', async () => {
    const table = await prisma.diningTable.create({
      data: {
        brandId: world.pizza.id,
        branchId: world.mall.id,
        name: '7',
        nameKey: '7',
        area: 'Terrace',
        seats: 4,
        x: 0,
        y: 0,
      },
    });
    await order({ status: 'open', total: '8.000', tableId: table.id });
    const mall = overviewOf(await (await asAdmin()).get(OVERVIEW)).branches[0];
    expect(mall).toMatchObject({ openOrders: 1, openTotal: '8.000', tablesInUse: 1, tables: 1 });
  });

  it('lists an old shift, voids and refunds under what needs attention (criterion 4)', async () => {
    const today = await prisma.shift.create({
      data: {
        brandId: world.pizza.id,
        branchId: world.mall.id,
        openedById: world.users.cashier.id,
        openedByName: 'Sara Cashier',
        openedAt: new Date('2026-10-14T10:00:00Z'),
        openingCash: '50.000',
      },
    });
    // Opened today: nothing to say.
    await prisma.shift.create({
      data: {
        brandId: world.pizza.id,
        branchId: world.downtown.id,
        openedById: world.users.cashier.id,
        openedByName: 'Ali',
        openedAt: new Date('2026-10-15T06:00:00Z'),
        openingCash: '50.000',
      },
    });
    await order({ status: 'voided', total: '6.000' });
    const paid = await order({ branch: world.downtown, total: '5.000' });
    await prisma.refund.create({
      data: {
        id: randomUUID(),
        orderId: paid.id,
        brandId: world.pizza.id,
        branchId: world.downtown.id,
        shiftId: today.id,
        amount: '2.000',
        method: 'cash',
        methodName: { en: 'Cash', ar: 'نقد' },
        reason: 'Cold',
        refundedById: world.users.cashier.id,
        createdAt: new Date('2026-10-15T15:00:00Z'),
      },
    });

    const overview = overviewOf(await (await asAdmin()).get(OVERVIEW));
    expect(
      overview.attention.map((row) => [row.kind, row.branchId, row.count, row.amount, row.name]),
    ).toEqual([
      ['old_shift', world.mall.id, 1, '0.000', 'Sara Cashier'],
      ['voids', world.mall.id, 1, '6.000', null],
      ['refunds', world.downtown.id, 1, '2.000', null],
    ]);
    expect(overview.summary).toMatchObject({ refunds: '2.000', voidedOrders: 1 });
    expect(overview.branches.map((branch) => branch.openShifts)).toEqual([1, 1, 0]);
  });

  it('shows a brand manager only their brand, and is refused to a branch manager (criterion 6)', async () => {
    await order({ total: '10.000' });
    await order({ branch: world.airport, total: '18.000', itemId: world.items.cheeseburger.id });

    const burger = as(app, await signIn(app, 'burger@x.io'));
    const own = overviewOf(await burger.get(OVERVIEW));
    expect(own.branches.map((branch) => branch.name.en)).toEqual(['Burger Airport']);
    expect(own.summary.sales).toBe('18.000');
    expect((await burger.get(`${OVERVIEW}?brandId=${world.pizza.id}`)).status).toBe(404);

    const admin = await asAdmin();
    const pizza = overviewOf(await admin.get(`${OVERVIEW}?brandId=${world.pizza.id}`));
    expect(pizza.summary.sales).toBe('10.000');

    const mall = as(app, await signIn(app, 'mall-manager@x.io'));
    expect((await mall.get(OVERVIEW)).status).toBe(403);
    const cashier = as(app, await signIn(app, 'cashier@x.io'));
    expect((await cashier.get(OVERVIEW)).status).toBe(403);
  });
});
