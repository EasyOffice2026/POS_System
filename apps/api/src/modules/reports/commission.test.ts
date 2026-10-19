import { randomUUID } from 'node:crypto';
import { type Order, orderSchema, salesReportSchema } from '@pos/shared';
import type request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { openShift } from '../../../test/factories';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { createMenuWorld, type MenuWorld } from '../../../test/menu-world';
import { as, signIn } from '../../../test/users-world';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

// Platform commission: the rate kept on each payment and refund, and the sales report.
// See docs/specs/025-platform-commission.md.
const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const app = createApp({ prisma, config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }) });

let world: MenuWorld;

const talabatAt = (commissionRate: string) => ({
  paymentMethods: [
    { key: 'knet', name: { en: 'KNET', ar: 'كي نت' }, isActive: true },
    { key: 'talabat', name: { en: 'Talabat', ar: 'طلبات' }, isActive: true, commissionRate },
  ],
});

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  world = await createMenuWorld(prisma, hasher);
  await prisma.brand.update({ where: { id: world.pizza.id }, data: { settings: talabatAt('18') } });
  await openShift(prisma, world.users.mallManager, world.mall);
});

type Api = ReturnType<typeof as>;
const ORDERS = '/api/v1/orders';
const asMallManager = async () => as(app, await signIn(app, 'mall-manager@x.io'));
const orderOf = (res: request.Response): Order => orderSchema.parse(res.body);

// A Cola (5.000) and a Margherita (20.000), paid as said.
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
const talabat = (amount: string) => ({
  id: randomUUID(),
  method: 'talabat',
  amount,
  reference: 'T-48213',
});
const cash = (amount: string) => ({ id: randomUUID(), method: 'cash', amount, tendered: amount });

describe('platform commission', () => {
  it('keeps the rate on each payment, so a new rate changes only new payments (criteria 1, 2, 4)', async () => {
    const api = await asMallManager();
    const first = await paidOrder(api, [talabat('25')]);

    await prisma.brand.update({
      where: { id: world.pizza.id },
      data: { settings: talabatAt('20') },
    });
    const second = await paidOrder(api, [talabat('15'), cash('10')]);

    const rows = await prisma.payment.findMany({ orderBy: { createdAt: 'asc' } });
    const byOrder = (orderId: string) =>
      rows
        .filter((row) => row.orderId === orderId)
        .map((row) => [row.method, row.commissionRate.toFixed(2), row.commission.toFixed(3)])
        .sort();
    expect(byOrder(first.id)).toEqual([['talabat', '18.00', '4.500']]);
    expect(byOrder(second.id)).toEqual([
      ['cash', '0.00', '0.000'],
      ['talabat', '20.00', '3.000'],
    ]);

    const date = first.businessDate;
    const report = salesReportSchema.parse(
      (await api.get(`/api/v1/reports/sales?from=${date}&to=${date}`)).body,
    );
    expect(report.summary.commissions).toBe('7.500');
    expect(report.payments).toEqual([
      expect.objectContaining({
        method: 'talabat',
        amount: '40.000',
        refunds: '0.000',
        commission: '7.500',
        net: '32.500',
      }),
      expect.objectContaining({ method: 'cash', amount: '10.000', commission: '0.000' }),
    ]);
  });

  it('gives commission back on a refund made through the platform (criterion 3)', async () => {
    const api = await asMallManager();
    const order = await paidOrder(api, [talabat('25')]);

    const half = await api.post(`${ORDERS}/${order.id}/refunds`, {
      id: randomUUID(),
      reason: 'Missing dish',
      amount: '12.5',
      method: 'talabat',
    });
    expect(half.status).toBe(200);
    const [row] = await prisma.refund.findMany();
    expect(row?.commission.toFixed(3)).toBe('2.250');

    const date = order.businessDate;
    const report = salesReportSchema.parse(
      (await api.get(`/api/v1/reports/sales?from=${date}&to=${date}`)).body,
    );
    expect(report.payments).toEqual([
      expect.objectContaining({
        method: 'talabat',
        amount: '25.000',
        refunds: '12.500',
        commission: '2.250',
        net: '10.250',
      }),
    ]);
    expect(report.summary.commissions).toBe('2.250');
  });

  it('gives no commission back on a refund in cash', async () => {
    const api = await asMallManager();
    const order = await paidOrder(api, [talabat('25')]);

    const res = await api.post(`${ORDERS}/${order.id}/refunds`, {
      id: randomUUID(),
      reason: 'Missing dish',
      amount: '5',
      method: 'cash',
    });
    expect(res.status).toBe(200);
    const [row] = await prisma.refund.findMany();
    expect(row?.commission.toFixed(3)).toBe('0.000');
  });
});
