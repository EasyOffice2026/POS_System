import { pageSchema, type SupplierDetail, supplierDetailSchema, supplierSchema } from '@pos/shared';
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
let clock = new Date('2026-10-15T08:00:00Z');
const app = createApp({
  prisma,
  config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }),
  now: () => clock,
});

let world: UsersWorld;
let mozzarella: { id: string };
let flour: { id: string };

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  clock = new Date('2026-10-15T08:00:00Z');
  await resetDatabase(prisma);
  world = await createUsersWorld(prisma, hasher);
  await createUser(prisma, hasher, {
    roleKey: 'purchaser',
    name: 'Pia Purchaser',
    brandId: world.pizza.id,
    branchIds: [world.mall.id],
    email: 'purchaser@x.io',
  });
  const ingredient = (en: string, cost: string) =>
    prisma.ingredient.create({
      data: {
        brandId: world.pizza.id,
        name: { en, ar: `${en} (ar)` },
        searchText: en.toLowerCase(),
        unit: 'kg',
        costPerUnit: cost,
      },
    });
  mozzarella = await ingredient('Mozzarella', '3.000');
  flour = await ingredient('Flour', '0.400');
});

type Api = ReturnType<typeof as>;
const SUPPLIERS = '/api/v1/inventory/suppliers';
const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));
const asBurgerManager = async () => as(app, await signIn(app, 'burger@x.io'));
const asPurchaser = async () => as(app, await signIn(app, 'purchaser@x.io'));

const supplierOf = (res: request.Response): SupplierDetail => supplierDetailSchema.parse(res.body);
const listOf = (res: request.Response) => pageSchema(supplierSchema).parse(res.body).data;
const messagesOf = (res: request.Response) =>
  (errorOf(res).details ?? []).map((detail) => `${detail.path}:${detail.message}`);

async function addGulfDairy(api: Api) {
  const res = await api.post(SUPPLIERS, {
    name: 'Gulf Dairy',
    phone: '+965 2222 3333',
    email: 'orders@gulfdairy.kw',
    paymentDays: 30,
  });
  expect(res.status).toBe(201);
  return supplierOf(res);
}

describe('suppliers', () => {
  it('are added by the brand manager, listed, and their names are unique (criterion 1)', async () => {
    const api = await asPizzaManager();
    const dairy = await addGulfDairy(api);
    expect(dairy).toMatchObject({
      brandId: world.pizza.id,
      name: 'Gulf Dairy',
      phone: '+965 2222 3333',
      email: 'orders@gulfdairy.kw',
      paymentDays: 30,
      contactName: null,
      isActive: true,
      priceCount: 0,
      prices: [],
    });

    const again = await api.post(SUPPLIERS, { name: 'gulf  dairy' });
    expect(again.status).toBe(400);
    expect(messagesOf(again)).toEqual(['name:SUPPLIER_NAME_TAKEN']);

    await api.post(SUPPLIERS, { name: 'Kuwait Flour Mills' });
    expect(listOf(await api.get(SUPPLIERS)).map((row) => row.name)).toEqual([
      'Gulf Dairy',
      'Kuwait Flour Mills',
    ]);
    expect(listOf(await api.get(`${SUPPLIERS}?q=flour`)).map((row) => row.name)).toEqual([
      'Kuwait Flour Mills',
    ]);
    await expect(
      prisma.auditLog.findMany({ where: { action: 'inventory.supplier.created' } }),
    ).resolves.toHaveLength(2);
  });

  it('are changed and deactivated, and a rename cannot take another name', async () => {
    const api = await asPizzaManager();
    const dairy = await addGulfDairy(api);
    await api.post(SUPPLIERS, { name: 'Kuwait Flour Mills' });

    const changed = supplierOf(
      await api.patch(`${SUPPLIERS}/${dairy.id}`, { contactName: 'Ahmad', paymentDays: 45 }),
    );
    expect(changed).toMatchObject({ contactName: 'Ahmad', paymentDays: 45 });
    const [row] = await prisma.auditLog.findMany({
      where: { action: 'inventory.supplier.updated' },
    });
    expect(row?.metadata).toEqual({ changed: ['contactName', 'paymentDays'] });

    const taken = await api.patch(`${SUPPLIERS}/${dairy.id}`, { name: 'KUWAIT FLOUR MILLS' });
    expect(messagesOf(taken)).toEqual(['name:SUPPLIER_NAME_TAKEN']);

    await api.patch(`${SUPPLIERS}/${dairy.id}`, { isActive: false });
    expect(
      listOf(await api.get(`${SUPPLIERS}?status=active`)).map((supplier) => supplier.name),
    ).toEqual(['Kuwait Flour Mills']);
  });
});

describe('the prices of a supplier', () => {
  it('are set per unit and shown with the ingredient and its cost (criterion 2)', async () => {
    const api = await asPizzaManager();
    const dairy = await addGulfDairy(api);

    const res = await api.put(`${SUPPLIERS}/${dairy.id}/prices`, {
      prices: [{ ingredientId: mozzarella.id, price: '2.8' }],
    });
    expect(res.status).toBe(200);
    const priced = supplierOf(res);
    expect(priced.priceCount).toBe(1);
    expect(priced.prices).toEqual([
      {
        ingredient: expect.objectContaining({ id: mozzarella.id, costPerUnit: '3.000' }) as unknown,
        price: '2.800',
        updatedAt: clock.toISOString(),
      },
    ]);
    expect(listOf(await api.get(SUPPLIERS))[0]?.priceCount).toBe(1);
    await expect(
      prisma.auditLog.findMany({ where: { action: 'inventory.supplier.prices_updated' } }),
    ).resolves.toHaveLength(1);
  });

  it('keep the time of a price that did not change', async () => {
    const api = await asPizzaManager();
    const dairy = await addGulfDairy(api);
    const first = clock.toISOString();
    await api.put(`${SUPPLIERS}/${dairy.id}/prices`, {
      prices: [
        { ingredientId: mozzarella.id, price: '2.800' },
        { ingredientId: flour.id, price: '0.350' },
      ],
    });

    clock = new Date('2026-10-20T08:00:00Z');
    const later = supplierOf(
      await api.put(`${SUPPLIERS}/${dairy.id}/prices`, {
        prices: [
          { ingredientId: mozzarella.id, price: '2.8' },
          { ingredientId: flour.id, price: '0.380' },
        ],
      }),
    );
    expect(
      later.prices.map((line) => [line.ingredient.name.en, line.price, line.updatedAt]),
    ).toEqual([
      ['Flour', '0.380', clock.toISOString()],
      ['Mozzarella', '2.800', first],
    ]);
  });

  it('refuse the same ingredient twice and an ingredient of another brand (criterion 3)', async () => {
    const api = await asPizzaManager();
    const dairy = await addGulfDairy(api);

    const twice = await api.put(`${SUPPLIERS}/${dairy.id}/prices`, {
      prices: [
        { ingredientId: flour.id, price: '1' },
        { ingredientId: flour.id, price: '2' },
      ],
    });
    expect(messagesOf(twice)).toEqual(['prices:INGREDIENT_DUPLICATE']);

    const buns = await prisma.ingredient.create({
      data: {
        brandId: world.burger.id,
        name: { en: 'Buns', ar: 'خبز' },
        searchText: 'buns',
        unit: 'piece',
      },
    });
    const other = await api.put(`${SUPPLIERS}/${dairy.id}/prices`, {
      prices: [{ ingredientId: buns.id, price: '0.1' }],
    });
    expect(messagesOf(other)).toEqual(['prices.0.ingredientId:INGREDIENT_NOT_FOUND']);
  });
});

describe('who sees suppliers', () => {
  it('lets the purchaser see them and their prices but change nothing (criterion 4)', async () => {
    const dairy = await addGulfDairy(await asPizzaManager());
    const purchaser = await asPurchaser();

    expect(listOf(await purchaser.get(SUPPLIERS)).map((row) => row.name)).toEqual(['Gulf Dairy']);
    expect((await purchaser.get(`${SUPPLIERS}/${dairy.id}`)).status).toBe(200);
    expect((await purchaser.post(SUPPLIERS, { name: 'Mine' })).status).toBe(403);
    expect((await purchaser.patch(`${SUPPLIERS}/${dairy.id}`, { paymentDays: 1 })).status).toBe(
      403,
    );
    expect((await purchaser.put(`${SUPPLIERS}/${dairy.id}/prices`, { prices: [] })).status).toBe(
      403,
    );
  });

  it('hides them from another brand (criterion 5)', async () => {
    const dairy = await addGulfDairy(await asPizzaManager());
    const burger = await asBurgerManager();

    expect(listOf(await burger.get(SUPPLIERS))).toEqual([]);
    expect((await burger.get(`${SUPPLIERS}/${dairy.id}`)).status).toBe(404);
    expect((await burger.patch(`${SUPPLIERS}/${dairy.id}`, { paymentDays: 1 })).status).toBe(404);
    // The same name is free in another brand.
    expect((await burger.post(SUPPLIERS, { name: 'Gulf Dairy' })).status).toBe(201);
  });
});
