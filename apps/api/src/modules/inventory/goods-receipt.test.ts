import { type PurchaseOrder, purchaseOrderSchema } from '@pos/shared';
import type request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { createUser } from '../../../test/factories';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { as, createUsersWorld, errorOf, signIn, type UsersWorld } from '../../../test/users-world';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const clock = new Date('2026-10-16T07:30:00Z');
const app = createApp({
  prisma,
  config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }),
  now: () => clock,
});

let world: UsersWorld;
let dairy: { id: string };
let mozzarella: { id: string };
let butter: { id: string };

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  world = await createUsersWorld(prisma, hasher);
  await createUser(prisma, hasher, {
    roleKey: 'purchaser',
    name: 'Pia Purchaser',
    brandId: world.pizza.id,
    branchIds: [world.mall.id],
    email: 'purchaser@x.io',
  });
  const ingredient = (en: string) =>
    prisma.ingredient.create({
      data: {
        brandId: world.pizza.id,
        name: { en, ar: `${en} (ar)` },
        searchText: en.toLowerCase(),
        unit: 'kg',
      },
    });
  mozzarella = await ingredient('Mozzarella');
  butter = await ingredient('Butter');
  dairy = await prisma.supplier.create({
    data: { brandId: world.pizza.id, name: 'Gulf Dairy', searchText: 'gulf dairy' },
  });
  // The Mall has 1 kg of mozzarella before the delivery.
  await prisma.branchStock.create({
    data: {
      brandId: world.pizza.id,
      branchId: world.mall.id,
      ingredientId: mozzarella.id,
      quantity: '1',
    },
  });
});

type Api = ReturnType<typeof as>;
const ORDERS = '/api/v1/inventory/purchase-orders';
const asPurchaser = async () => as(app, await signIn(app, 'purchaser@x.io'));
const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));

const orderOf = (res: request.Response): PurchaseOrder => purchaseOrderSchema.parse(res.body);
const messagesOf = (res: request.Response) =>
  (errorOf(res).details ?? []).map((detail) => `${detail.path}:${detail.message}`);
const stockAt = async (branchId: string, ingredientId: string) =>
  (
    await prisma.branchStock.findUnique({
      where: { branchId_ingredientId: { branchId, ingredientId } },
    })
  )?.quantity.toFixed(3) ?? null;

// Order: 12 kg of mozzarella at 2.800 and 2 kg of butter at 4.000, sent.
async function sentOrder(api: Api, branchId = world.mall.id, send = true) {
  const created = orderOf(
    await api.post(ORDERS, {
      branchId,
      supplierId: dairy.id,
      lines: [
        { ingredientId: mozzarella.id, quantity: '12', unitPrice: '2.8' },
        { ingredientId: butter.id, quantity: '2', unitPrice: '4' },
      ],
    }),
  );
  return send ? orderOf(await api.post(`${ORDERS}/${created.id}/send`, {})) : created;
}

const receive = (api: Api, orderId: string, body: object) =>
  api.post(`${ORDERS}/${orderId}/receive`, body);

describe('receiving a purchase order', () => {
  it('puts what arrived into stock at the invoice price and closes the order (criterion 1)', async () => {
    const api = await asPurchaser();
    const order = await sentOrder(api);

    const res = await receive(api, order.id, {
      invoiceNumber: 'INV-5521',
      note: 'Half a kilo short',
      lines: [
        { ingredientId: mozzarella.id, quantity: '11.5', unitPrice: '2.9' },
        { ingredientId: butter.id, quantity: '2' },
      ],
    });
    expect(res.status).toBe(200);
    const received = orderOf(res);
    expect(received).toMatchObject({
      status: 'received',
      receivedByName: 'Pia Purchaser',
      receivedAt: clock.toISOString(),
      invoiceNumber: 'INV-5521',
      receiveNote: 'Half a kilo short',
      total: '41.600',
      receivedTotal: '41.350',
    });
    const line = (id: string) => received.lines.find((row) => row.ingredient.id === id);
    expect(line(mozzarella.id)).toMatchObject({
      quantity: '12.000',
      unitPrice: '2.800',
      receivedQuantity: '11.500',
      receivedPrice: '2.900',
      receivedTotal: '33.350',
    });
    expect(line(butter.id)).toMatchObject({ receivedQuantity: '2.000', receivedPrice: '4.000' });

    expect(await stockAt(world.mall.id, mozzarella.id)).toBe('12.500');
    expect(await stockAt(world.mall.id, butter.id)).toBe('2.000');
    const movements = await prisma.stockMovement.findMany({ orderBy: { quantity: 'desc' } });
    expect(
      movements.map((row) => [row.kind, row.quantity.toFixed(3), row.note, row.referenceId]),
    ).toEqual([
      ['received', '11.500', `Purchase order ${order.number}`, order.id],
      ['received', '2.000', `Purchase order ${order.number}`, order.id],
    ]);
    const [audit] = await prisma.auditLog.findMany({
      where: { action: 'inventory.purchase_order.received' },
    });
    expect(audit?.metadata).toEqual({
      number: order.number,
      receivedTotal: '41.350',
      differing: 1,
    });
  });

  it('receives a line left out as 0, with no movement (criterion 2)', async () => {
    const api = await asPurchaser();
    const order = await sentOrder(api);

    const received = orderOf(
      await receive(api, order.id, { lines: [{ ingredientId: mozzarella.id, quantity: '12' }] }),
    );
    expect(received.receivedTotal).toBe('33.600');
    expect(received.lines.find((row) => row.ingredient.id === butter.id)).toMatchObject({
      receivedQuantity: '0.000',
      receivedTotal: '0.000',
    });
    expect(await stockAt(world.mall.id, butter.id)).toBeNull();
    await expect(prisma.stockMovement.count()).resolves.toBe(1);
  });

  it('refuses a draft and an order received already, and changes no stock (criterion 3)', async () => {
    const api = await asPurchaser();
    const draft = await sentOrder(api, world.mall.id, false);
    const lines = [{ ingredientId: mozzarella.id, quantity: '1' }];

    const early = await receive(api, draft.id, { lines });
    expect(early.status).toBe(409);
    expect(errorOf(early).code).toBe('ORDER_NOT_SENT');

    const order = await sentOrder(api);
    await receive(api, order.id, { lines });
    const twice = await receive(api, order.id, { lines });
    expect(errorOf(twice).code).toBe('ORDER_NOT_SENT');
    expect(await stockAt(world.mall.id, mozzarella.id)).toBe('2.000');
  });

  it('needs something to arrive, and only ingredients of the order (criterion 4)', async () => {
    const api = await asPurchaser();
    const order = await sentOrder(api);

    const empty = await receive(api, order.id, {
      lines: [{ ingredientId: mozzarella.id, quantity: '0' }],
    });
    expect(messagesOf(empty)).toEqual(['lines:RECEIPT_EMPTY']);

    const basil = await prisma.ingredient.create({
      data: {
        brandId: world.pizza.id,
        name: { en: 'Basil', ar: 'ريحان' },
        searchText: 'basil',
        unit: 'kg',
      },
    });
    const other = await receive(api, order.id, {
      lines: [{ ingredientId: basil.id, quantity: '1' }],
    });
    expect(messagesOf(other)).toEqual(['lines.0.ingredientId:INGREDIENT_NOT_FOUND']);
    expect(orderOf(await api.get(`${ORDERS}/${order.id}`)).status).toBe('sent');
  });

  it('lets the purchaser receive at their branch only (criterion 5)', async () => {
    const downtown = await sentOrder(await asPizzaManager(), world.downtown.id);
    const purchaser = await asPurchaser();

    const res = await receive(purchaser, downtown.id, {
      lines: [{ ingredientId: mozzarella.id, quantity: '1' }],
    });
    expect(res.status).toBe(404);
    expect(await stockAt(world.downtown.id, mozzarella.id)).toBeNull();
  });
});
