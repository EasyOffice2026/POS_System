import {
  pageSchema,
  type PurchaseOrder,
  purchaseOrderSchema,
  purchaseOrderSummarySchema,
} from '@pos/shared';
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
const clock = new Date('2026-10-15T09:00:00Z');
const app = createApp({
  prisma,
  config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }),
  now: () => clock,
});

let world: UsersWorld;
let dairy: { id: string };
let mozzarella: { id: string };
let basil: { id: string };

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
  basil = await ingredient('Basil');
  dairy = await prisma.supplier.create({
    data: {
      brandId: world.pizza.id,
      name: 'Gulf Dairy',
      searchText: 'gulf dairy',
      phone: '+965 2222 3333',
    },
  });
  await prisma.supplierPrice.create({
    data: {
      supplierId: dairy.id,
      ingredientId: mozzarella.id,
      brandId: world.pizza.id,
      price: '2.800',
      updatedAt: clock,
    },
  });
});

type Api = ReturnType<typeof as>;
const ORDERS = '/api/v1/inventory/purchase-orders';
const asPurchaser = async () => as(app, await signIn(app, 'purchaser@x.io'));
const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));
const asBurgerManager = async () => as(app, await signIn(app, 'burger@x.io'));

const orderOf = (res: request.Response): PurchaseOrder => purchaseOrderSchema.parse(res.body);
const messagesOf = (res: request.Response) =>
  (errorOf(res).details ?? []).map((detail) => `${detail.path}:${detail.message}`);

async function draftAtMall(
  api: Api,
  lines: object[] = [{ ingredientId: mozzarella.id, quantity: '10' }],
) {
  const res = await api.post(ORDERS, { branchId: world.mall.id, supplierId: dairy.id, lines });
  expect(res.status).toBe(201);
  return orderOf(res);
}

describe('a new purchase order', () => {
  it('takes the supplier price when the line has none (criterion 1)', async () => {
    const order = await draftAtMall(await asPurchaser());
    expect(order).toMatchObject({
      status: 'draft',
      branchId: world.mall.id,
      supplier: { id: dairy.id, name: 'Gulf Dairy', phone: '+965 2222 3333' },
      branch: { id: world.mall.id, name: { en: 'Pizza Mall' } },
      total: '28.000',
      lineCount: 1,
      createdByName: 'Pia Purchaser',
      createdAt: clock.toISOString(),
      expectedOn: null,
    });
    expect(order.number).toBeGreaterThan(0);
    expect(
      order.lines.map((line) => [
        line.ingredient.id,
        line.quantity,
        line.unitPrice,
        line.lineTotal,
      ]),
    ).toEqual([[mozzarella.id, '10.000', '2.800', '28.000']]);
    await expect(
      prisma.auditLog.findMany({ where: { action: 'inventory.purchase_order.created' } }),
    ).resolves.toHaveLength(1);
    // No stock moves until the goods are received.
    await expect(prisma.stockMovement.count()).resolves.toBe(0);
  });

  it('needs a price for an ingredient the supplier has none for (criterion 3)', async () => {
    const api = await asPurchaser();
    const res = await api.post(ORDERS, {
      branchId: world.mall.id,
      supplierId: dairy.id,
      lines: [
        { ingredientId: mozzarella.id, quantity: '1' },
        { ingredientId: basil.id, quantity: '1' },
      ],
    });
    expect(messagesOf(res)).toEqual(['lines.1.unitPrice:PRICE_REQUIRED']);

    const priced = await draftAtMall(api, [
      { ingredientId: basil.id, quantity: '0.5', unitPrice: '4.25' },
    ]);
    expect(priced.total).toBe('2.125');
  });

  it('refuses an inactive supplier (criterion 5)', async () => {
    await prisma.supplier.update({ where: { id: dairy.id }, data: { isActive: false } });
    const res = await (
      await asPurchaser()
    ).post(ORDERS, {
      branchId: world.mall.id,
      supplierId: dairy.id,
      lines: [{ ingredientId: mozzarella.id, quantity: '1' }],
    });
    expect(messagesOf(res)).toEqual(['supplierId:SUPPLIER_NOT_FOUND']);
  });
});

describe('a draft', () => {
  it('is changed as a whole, then sent and fixed (criterion 2)', async () => {
    const api = await asPurchaser();
    const draft = await draftAtMall(api);

    const changed = orderOf(
      await api.put(`${ORDERS}/${draft.id}`, {
        expectedOn: '2026-10-18',
        note: 'Morning delivery',
        lines: [{ ingredientId: mozzarella.id, quantity: '12' }],
      }),
    );
    expect(changed).toMatchObject({
      total: '33.600',
      expectedOn: '2026-10-18',
      note: 'Morning delivery',
    });

    const sent = orderOf(await api.post(`${ORDERS}/${draft.id}/send`, {}));
    expect(sent).toMatchObject({
      status: 'sent',
      sentByName: 'Pia Purchaser',
      sentAt: clock.toISOString(),
    });

    const late = await api.put(`${ORDERS}/${draft.id}`, {
      lines: [{ ingredientId: mozzarella.id, quantity: '1' }],
    });
    expect(late.status).toBe(409);
    expect(errorOf(late).code).toBe('ORDER_NOT_DRAFT');
    expect(errorOf(await api.post(`${ORDERS}/${draft.id}/send`, {})).code).toBe('ORDER_NOT_DRAFT');
    await expect(
      prisma.auditLog.findMany({ where: { action: { startsWith: 'inventory.purchase_order.' } } }),
    ).resolves.toHaveLength(3);
  });

  it('keeps the expected date when a change leaves it out, and clears it with null', async () => {
    const api = await asPurchaser();
    const draft = await draftAtMall(api);
    const lines = [{ ingredientId: mozzarella.id, quantity: '10' }];
    await api.put(`${ORDERS}/${draft.id}`, { expectedOn: '2026-10-18', lines });
    expect(orderOf(await api.put(`${ORDERS}/${draft.id}`, { lines })).expectedOn).toBe(
      '2026-10-18',
    );
    expect(
      orderOf(await api.put(`${ORDERS}/${draft.id}`, { expectedOn: null, lines })).expectedOn,
    ).toBeNull();
  });
});

describe('cancelling', () => {
  it('needs a reason, and a cancelled order stays closed (criterion 4)', async () => {
    const api = await asPurchaser();
    const draft = await draftAtMall(api);
    await api.post(`${ORDERS}/${draft.id}/send`, {});

    expect(messagesOf(await api.post(`${ORDERS}/${draft.id}/cancel`, { reason: '' }))).toEqual([
      'reason:NOTE_REQUIRED',
    ]);
    const cancelled = orderOf(
      await api.post(`${ORDERS}/${draft.id}/cancel`, { reason: 'Found a better price' }),
    );
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      cancelledByName: 'Pia Purchaser',
      cancelReason: 'Found a better price',
    });

    const again = await api.post(`${ORDERS}/${draft.id}/cancel`, { reason: 'Again' });
    expect(again.status).toBe(409);
    expect(errorOf(again).code).toBe('ORDER_CLOSED');
  });
});

describe('who sees orders', () => {
  it('keeps the purchaser to their branch and another brand out (criterion 6)', async () => {
    const manager = await asPizzaManager();
    const downtown = orderOf(
      await manager.post(ORDERS, {
        branchId: world.downtown.id,
        supplierId: dairy.id,
        lines: [{ ingredientId: mozzarella.id, quantity: '2' }],
      }),
    );
    const purchaser = await asPurchaser();
    const mall = await draftAtMall(purchaser);

    const list = pageSchema(purchaseOrderSummarySchema).parse(
      (await purchaser.get(`${ORDERS}?branchId=${world.mall.id}`)).body,
    );
    expect(list.data.map((row) => [row.id, row.supplier.name, row.total, row.lineCount])).toEqual([
      [mall.id, 'Gulf Dairy', '28.000', 1],
    ]);
    expect((await purchaser.get(`${ORDERS}/${downtown.id}`)).status).toBe(404);
    expect((await purchaser.get(`${ORDERS}?branchId=${world.downtown.id}`)).status).toBe(404);
    expect(
      (
        await purchaser.post(ORDERS, {
          branchId: world.downtown.id,
          supplierId: dairy.id,
          lines: [{ ingredientId: mozzarella.id, quantity: '1' }],
        })
      ).status,
    ).toBe(404);

    const burger = await asBurgerManager();
    expect((await burger.get(`${ORDERS}/${mall.id}`)).status).toBe(404);
    expect((await burger.post(`${ORDERS}/${mall.id}/cancel`, { reason: 'x' })).status).toBe(404);
  });
});
