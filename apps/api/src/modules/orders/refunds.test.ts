import { randomUUID } from 'node:crypto';
import { type Order, orderSchema, shiftReportSchema } from '@pos/shared';
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

const MANAGER = { staffCode: '2001', pin: '7351' };
let world: MenuWorld;

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  world = await createMenuWorld(prisma, hasher);
  await prisma.user.update({
    where: { id: world.users.mallManager.id },
    data: { staffCode: MANAGER.staffCode, pinHash: await hasher.hash(MANAGER.pin) },
  });
  await prisma.brand.update({
    where: { id: world.pizza.id },
    data: {
      settings: {
        paymentMethods: [
          { key: 'knet', name: { en: 'KNET', ar: 'كي نت' }, isActive: true },
          { key: 'link', name: { en: 'Link', ar: 'لينك' }, isActive: true },
        ],
      },
    },
  });
  await openShift(prisma, world.users.cashier, world.mall);
  await openShift(prisma, world.users.mallManager, world.mall);
});

type Api = ReturnType<typeof as>;
const ORDERS = '/api/v1/orders';
const asCashier = async () => as(app, await signIn(app, 'cashier@x.io'));
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
const cash25 = () => [{ id: randomUUID(), method: 'cash', amount: '25', tendered: '25' }];
const knet25 = () => [{ id: randomUUID(), method: 'knet', amount: '25', reference: 'K1' }];

const refund = (api: Api, orderId: string, body: object) =>
  api.post(`${ORDERS}/${orderId}/refunds`, { id: randomUUID(), reason: 'Food came back', ...body });

describe('POST /orders/:id/refunds', () => {
  it('gives the whole order back in cash and takes it off the shift (criterion 1)', async () => {
    const api = await asMallManager();
    const order = await paidOrder(api, cash25());

    const res = await refund(api, order.id, { amount: '25', method: 'cash' });
    expect(res.status).toBe(200);
    const refunded = orderOf(res);
    expect(refunded).toMatchObject({ status: 'paid', refunded: '25.000' });
    expect(refunded.refunds).toEqual([
      expect.objectContaining({
        amount: '25.000',
        method: 'cash',
        methodName: { en: 'Cash', ar: 'نقدًا' },
        reason: 'Food came back',
        refundedById: world.users.mallManager.id,
        approvedById: null,
      }),
    ]);

    const shift = await prisma.shift.findFirstOrThrow({
      where: { openedById: world.users.mallManager.id },
    });
    const report = shiftReportSchema.parse((await api.get(`/api/v1/shifts/${shift.id}`)).body);
    expect(report.figures).toMatchObject({
      refunds: '25.000',
      refundsByMethod: [
        { method: 'cash', amount: '25.000', methodName: { en: 'Cash', ar: 'نقدًا' } },
      ],
      cashExpected: '50.000',
    });
    const [row] = await prisma.auditLog.findMany({ where: { action: 'order.refunded' } });
    expect(row?.metadata).toMatchObject({ amount: '25.000', method: 'cash', refunded: '25.000' });
  });

  it('refuses more than is left (criterion 2), in parts', async () => {
    const api = await asMallManager();
    const order = await paidOrder(api, cash25());

    expect(orderOf(await refund(api, order.id, { amount: '20', method: 'cash' })).refunded).toBe(
      '20.000',
    );
    const tooMuch = await refund(api, order.id, { amount: '5.001', method: 'cash' });
    expect(tooMuch.status).toBe(400);
    expect(errorOf(tooMuch).details).toEqual([{ path: 'amount', message: 'REFUND_TOO_MUCH' }]);
    expect(orderOf(await refund(api, order.id, { amount: '5', method: 'cash' })).refunded).toBe(
      '25.000',
    );
    expect(await prisma.refund.count()).toBe(2);
  });

  it('gives money back the way it came, or in cash (criterion 3)', async () => {
    const api = await asMallManager();
    const order = await paidOrder(api, knet25());

    const link = await refund(api, order.id, { amount: '5', method: 'link' });
    expect(link.status).toBe(400);
    expect(errorOf(link).details).toEqual([{ path: 'method', message: 'REFUND_METHOD_INVALID' }]);
    const knet = orderOf(await refund(api, order.id, { amount: '5', method: 'knet' }));
    expect(knet.refunds[0]).toMatchObject({
      method: 'knet',
      methodName: { en: 'KNET', ar: 'كي نت' },
    });
    const cash = orderOf(await refund(api, order.id, { amount: '5', method: 'cash' }));
    expect(cash.refunded).toBe('10.000');
  });

  it('needs a manager for a cashier (criterion 4)', async () => {
    const api = await asCashier();
    const order = await paidOrder(api, cash25());

    const refused = await refund(api, order.id, { amount: '5', method: 'cash' });
    expect(errorOf(refused).details).toEqual([{ path: 'approval', message: 'APPROVAL_REQUIRED' }]);

    const res = await refund(api, order.id, { amount: '5', method: 'cash', approval: MANAGER });
    expect(res.status).toBe(200);
    expect(orderOf(res).refunds[0]).toMatchObject({
      refundedById: world.users.cashier.id,
      approvedById: world.users.mallManager.id,
    });
    const [row] = await prisma.auditLog.findMany({ where: { action: 'order.refunded' } });
    expect(row?.metadata).toMatchObject({ approvedById: world.users.mallManager.id });

    // It is counted in the cashier's shift, who gave it, not the manager's.
    const shift = await prisma.shift.findFirstOrThrow({
      where: { openedById: world.users.cashier.id },
    });
    expect((await prisma.refund.findFirstOrThrow()).shiftId).toBe(shift.id);
  });

  it('gives a refund sent twice once (criterion 5)', async () => {
    const api = await asMallManager();
    const order = await paidOrder(api, cash25());
    const body = { id: randomUUID(), amount: '5', method: 'cash', reason: 'Twice' };

    const first = orderOf(await api.post(`${ORDERS}/${order.id}/refunds`, body));
    const second = await api.post(`${ORDERS}/${order.id}/refunds`, body);
    expect(second.status).toBe(200);
    expect(orderOf(second)).toEqual(first);
    expect(await prisma.refund.count()).toBe(1);

    const other = await paidOrder(api, cash25());
    const taken = await api.post(`${ORDERS}/${other.id}/refunds`, body);
    expect(taken.status).toBe(409);
    expect(errorOf(taken).code).toBe('REFUND_ID_TAKEN');
  });

  it('refuses an order that is not paid, and needs an open shift', async () => {
    const api = await asMallManager();
    const open = orderOf(await api.post(ORDERS, { branchId: world.mall.id, type: 'takeaway' }));
    const notPaid = await refund(api, open.id, { amount: '1', method: 'cash' });
    expect(notPaid.status).toBe(409);
    expect(errorOf(notPaid).code).toBe('ORDER_NOT_PAID');

    const order = await paidOrder(api, cash25());
    await prisma.shift.updateMany({
      where: { openedById: world.users.mallManager.id },
      data: {
        status: 'closed',
        closedById: world.users.mallManager.id,
        closedByName: 'Maha',
        closedAt: new Date(),
        countedCash: '0',
        expectedCash: '0',
        difference: '0',
      },
    });
    const noShift = await refund(api, order.id, { amount: '1', method: 'cash' });
    expect(noShift.status).toBe(409);
    expect(errorOf(noShift).code).toBe('SHIFT_REQUIRED');
  });

  it('checks the request', async () => {
    const api = await asMallManager();
    const order = await paidOrder(api, cash25());
    const res = await api.post(`${ORDERS}/${order.id}/refunds`, {
      id: randomUUID(),
      amount: '0',
      method: 'cash',
    });
    expect(res.status).toBe(400);
    expect(errorOf(res).details?.map((detail) => detail.message)).toEqual(
      expect.arrayContaining(['REFUND_AMOUNT_INVALID', 'REASON_REQUIRED']),
    );
  });
});
