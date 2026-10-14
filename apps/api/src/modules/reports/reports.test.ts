import { randomUUID } from 'node:crypto';
import { type SalesReport, salesReportSchema } from '@pos/shared';
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
let shiftId: string;
let orderNumber = 0;

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  world = await createMenuWorld(prisma, hasher);
  shiftId = (await openShift(prisma, world.users.cashier, world.mall)).id;
  orderNumber = 0;
});

const REPORT = '/api/v1/reports/sales';
const reportOf = (res: request.Response): SalesReport => salesReportSchema.parse(res.body);

interface SaleLine {
  itemId?: string;
  comboId?: string;
  quantity: number;
  unitPrice: string;
  voided?: boolean;
}

// An order written straight to the database: its lines, its payments, and what it adds up to.
async function sale(input: {
  branch?: { id: string; brandId: string };
  date?: string;
  status?: 'paid' | 'voided';
  lines: SaleLine[];
  discount?: string;
  payments?: { method: string; name: string; amount: string }[];
}) {
  const branch = input.branch ?? world.mall;
  const lineTotal = (line: SaleLine) => (Number(line.unitPrice) * line.quantity).toFixed(3);
  const subtotal = input.lines
    .filter((line) => !line.voided)
    .reduce((sum, line) => sum + Number(lineTotal(line)), 0);
  const discount = Number(input.discount ?? '0');
  orderNumber += 1;
  const order = await prisma.order.create({
    data: {
      brandId: branch.brandId,
      branchId: branch.id,
      businessDate: new Date(`${input.date ?? '2026-10-14'}T00:00:00Z`),
      number: orderNumber,
      type: 'takeaway',
      status: input.status ?? 'paid',
      subtotal: subtotal.toFixed(3),
      discountAmount: discount.toFixed(3),
      total: (subtotal - discount).toFixed(3),
      openedById: world.users.cashier.id,
      ...((input.status ?? 'paid') === 'paid'
        ? { paidAt: new Date(), paidById: world.users.cashier.id }
        : { voidedAt: new Date(), voidedById: world.users.cashier.id, voidReason: 'Left' }),
      ...(discount > 0
        ? { discountKind: 'amount' as const, discountValue: discount.toFixed(3) }
        : {}),
    },
  });
  for (const [position, line] of input.lines.entries()) {
    await prisma.orderLine.create({
      data: {
        orderId: order.id,
        brandId: branch.brandId,
        branchId: branch.id,
        kind: line.comboId ? 'combo' : 'item',
        itemId: line.itemId ?? null,
        comboId: line.comboId ?? null,
        name: { en: 'x', ar: 'x' },
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        lineTotal: lineTotal(line),
        status: line.voided ? 'voided' : 'sent',
        position,
      },
    });
  }
  const payments = input.payments ?? [
    { method: 'cash', name: 'Cash', amount: (subtotal - discount).toFixed(3) },
  ];
  if ((input.status ?? 'paid') === 'paid') {
    for (const payment of payments) {
      await prisma.payment.create({
        data: {
          id: randomUUID(),
          orderId: order.id,
          brandId: branch.brandId,
          branchId: branch.id,
          method: payment.method,
          methodName: { en: payment.name, ar: payment.name },
          amount: payment.amount,
          tendered: payment.method === 'cash' ? payment.amount : null,
          takenById: world.users.cashier.id,
        },
      });
    }
  }
  return order;
}

async function refund(orderId: string, amount: string, method = 'cash') {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  await prisma.refund.create({
    data: {
      id: randomUUID(),
      orderId,
      brandId: order.brandId,
      branchId: order.branchId,
      shiftId,
      amount,
      method,
      methodName: { en: method === 'cash' ? 'Cash' : method, ar: method },
      reason: 'Cold pizza',
      refundedById: world.users.cashier.id,
    },
  });
  await prisma.order.update({ where: { id: orderId }, data: { refunded: amount } });
}

const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));
const day = (from: string, to = from) => `${REPORT}?from=${from}&to=${to}`;

describe('the sales report', () => {
  it('adds up the paid orders and counts the voided apart (criterion 1)', async () => {
    await sale({ lines: [{ itemId: world.items.margherita.id, quantity: 1, unitPrice: '20' }] });
    await sale({
      lines: [{ itemId: world.items.pepperoni.id, quantity: 1, unitPrice: '30' }],
      discount: '3',
    });
    await sale({
      status: 'voided',
      lines: [{ itemId: world.items.cola.id, quantity: 4, unitPrice: '5' }],
    });
    // Another day, outside the report.
    await sale({
      date: '2026-10-13',
      lines: [{ itemId: world.items.cola.id, quantity: 1, unitPrice: '5' }],
    });

    const res = await (await asPizzaManager()).get(day('2026-10-14'));
    expect(res.status).toBe(200);
    expect(reportOf(res).summary).toEqual({
      orders: 2,
      grossSales: '50.000',
      discounts: '3.000',
      netSales: '47.000',
      refunds: '0.000',
      netAfterRefunds: '47.000',
      averageOrder: '23.500',
      voidedOrders: 1,
    });
  });

  it('takes refunds off and shows them on the way they were given (criterion 2)', async () => {
    const first = await sale({
      lines: [{ itemId: world.items.margherita.id, quantity: 1, unitPrice: '20' }],
      payments: [{ method: 'knet', name: 'KNET', amount: '20.000' }],
    });
    await sale({ lines: [{ itemId: world.items.pepperoni.id, quantity: 1, unitPrice: '27' }] });
    await refund(first.id, '5.000');

    const report = reportOf(await (await asPizzaManager()).get(day('2026-10-14')));
    expect(report.summary).toMatchObject({ refunds: '5.000', netAfterRefunds: '42.000' });
    expect(
      report.payments.map((row) => [row.method, row.name.en, row.count, row.amount, row.refunds]),
    ).toEqual([
      ['cash', 'Cash', 1, '27.000', '5.000'],
      ['knet', 'KNET', 1, '20.000', '0.000'],
    ]);
  });

  it('shows each dish with its food cost from the recipe (criterion 3)', async () => {
    const cheese = await prisma.ingredient.create({
      data: {
        brandId: world.pizza.id,
        name: { en: 'Mozzarella', ar: 'موزاريلا' },
        searchText: 'mozzarella',
        unit: 'kg',
        costPerUnit: '30.000',
      },
    });
    // 0.080 kg at 30.000 per kg: 2.400 a pizza.
    await prisma.recipeLine.create({
      data: {
        brandId: world.pizza.id,
        itemId: world.items.margherita.id,
        ingredientId: cheese.id,
        quantity: '0.080',
      },
    });
    await sale({
      lines: [
        { itemId: world.items.margherita.id, quantity: 2, unitPrice: '20' },
        { itemId: world.items.cola.id, quantity: 1, unitPrice: '5' },
        { itemId: world.items.pepperoni.id, quantity: 1, unitPrice: '24', voided: true },
      ],
    });
    await sale({ lines: [{ itemId: world.items.margherita.id, quantity: 1, unitPrice: '20' }] });

    const report = reportOf(await (await asPizzaManager()).get(day('2026-10-14')));
    expect(
      report.items.map((row) => [
        row.name.en,
        row.quantity,
        row.sales,
        row.foodCost,
        row.foodCostPercent,
      ]),
    ).toEqual([
      ['Margherita', 3, '60.000', '7.200', 12],
      ['Cola', 1, '5.000', null, null],
    ]);
    expect(report.categories.map((row) => [row.name?.en, row.quantity, row.sales])).toEqual([
      ['Pizzas', 3, '60.000'],
      ['Drinks', 1, '5.000'],
    ]);
  });

  it('lists every day of the period, the days without sales too', async () => {
    await sale({
      date: '2026-10-12',
      lines: [{ itemId: world.items.cola.id, quantity: 2, unitPrice: '5' }],
    });
    await sale({
      date: '2026-10-14',
      lines: [{ itemId: world.items.cola.id, quantity: 1, unitPrice: '5' }],
    });

    const report = reportOf(await (await asPizzaManager()).get(day('2026-10-12', '2026-10-14')));
    expect(report.days).toEqual([
      { date: '2026-10-12', orders: 1, netSales: '10.000', refunds: '0.000' },
      { date: '2026-10-13', orders: 0, netSales: '0.000', refunds: '0.000' },
      { date: '2026-10-14', orders: 1, netSales: '5.000', refunds: '0.000' },
    ]);
  });

  it('refuses a period longer than 92 days (criterion 4)', async () => {
    const res = await (await asPizzaManager()).get(day('2026-07-01', '2026-10-14'));
    expect(res.status).toBe(400);
    expect(errorOf(res).details).toEqual([{ path: 'to', message: 'RANGE_TOO_LONG' }]);
  });
});

describe('who sees the sales report', () => {
  it('keeps the branch manager to their branch and the cashier out (criterion 5)', async () => {
    await sale({ lines: [{ itemId: world.items.cola.id, quantity: 1, unitPrice: '5' }] });
    await sale({
      branch: world.downtown,
      lines: [{ itemId: world.items.cola.id, quantity: 3, unitPrice: '5' }],
    });

    const brand = reportOf(await (await asPizzaManager()).get(day('2026-10-14')));
    expect(brand.summary.netSales).toBe('20.000');
    const downtown = reportOf(
      await (await asPizzaManager()).get(`${day('2026-10-14')}&branchId=${world.downtown.id}`),
    );
    expect(downtown.summary.netSales).toBe('15.000');

    const mall = as(app, await signIn(app, 'mall-manager@x.io'));
    expect(reportOf(await mall.get(day('2026-10-14'))).summary.netSales).toBe('5.000');
    expect((await mall.get(`${day('2026-10-14')}&branchId=${world.downtown.id}`)).status).toBe(404);

    const cashier = as(app, await signIn(app, 'cashier@x.io'));
    expect((await cashier.get(day('2026-10-14'))).status).toBe(403);

    const burger = as(app, await signIn(app, 'burger@x.io'));
    expect(reportOf(await burger.get(day('2026-10-14'))).summary.orders).toBe(0);
  });

  it('asks a group admin which brand', async () => {
    const admin = as(app, await signIn(app, 'admin@x.io'));
    const res = await admin.get(day('2026-10-14'));
    expect(errorOf(res).details).toEqual([{ path: 'brandId', message: 'BRAND_REQUIRED' }]);
    const pizza = await admin.get(`${day('2026-10-14')}&brandId=${world.pizza.id}`);
    expect(pizza.status).toBe(200);
  });
});
