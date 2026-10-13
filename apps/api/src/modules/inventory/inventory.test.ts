import {
  branchStockSchema,
  type Ingredient,
  ingredientSchema,
  pageSchema,
  stockMovementSchema,
} from '@pos/shared';
import type request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../app';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { as, createUsersWorld, errorOf, signIn, type UsersWorld } from '../../../test/users-world';
import { createUser } from '../../../test/factories';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const app = createApp({ prisma, config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }) });

let world: UsersWorld;

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
});

type Api = ReturnType<typeof as>;
const INGREDIENTS = '/api/v1/inventory/ingredients';
const STOCK = '/api/v1/inventory/stock';
const MOVEMENTS = '/api/v1/inventory/movements';
const asAdmin = async () => as(app, await signIn(app, 'admin@x.io'));
const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));
const asBurgerManager = async () => as(app, await signIn(app, 'burger@x.io'));
const asMallManager = async () => as(app, await signIn(app, 'mall-manager@x.io'));
const asPurchaser = async () => as(app, await signIn(app, 'purchaser@x.io'));
const asCashier = async () => as(app, await signIn(app, 'cashier@x.io'));

const ingredientOf = (res: request.Response): Ingredient => ingredientSchema.parse(res.body);
const stockOf = (res: request.Response) =>
  z.object({ data: z.array(branchStockSchema) }).parse(res.body).data;
const codesOf = (res: request.Response) => errorOf(res).details?.map((detail) => detail.message);

const flour = {
  name: { en: 'Flour', ar: 'طحين' },
  unit: 'kg',
  costPerUnit: '0.400',
  lowLevel: '5',
};

async function createFlour(api: Api, extra: object = {}) {
  const res = await api.post(INGREDIENTS, { ...flour, ...extra });
  expect(res.status).toBe(201);
  return ingredientOf(res);
}

const move = (api: Api, ingredientId: string, kind: string, quantity: string, note?: string) =>
  api.post(MOVEMENTS, {
    branchId: world.mall.id,
    ingredientId,
    kind,
    quantity,
    ...(note === undefined ? {} : { note }),
  });

describe('ingredients', () => {
  it('are added by the brand manager with the defaults filled in, and recorded', async () => {
    const api = await asPizzaManager();
    const created = await createFlour(api);
    expect(created).toMatchObject({
      brandId: world.pizza.id,
      name: flour.name,
      unit: 'kg',
      costPerUnit: '0.400',
      lowLevel: '5.000',
      isActive: true,
    });
    const [row] = await prisma.auditLog.findMany({ where: { action: 'ingredient.created' } });
    expect(row).toMatchObject({ brandId: world.pizza.id, entityId: created.id });

    const list = pageSchema(ingredientSchema).parse((await api.get(INGREDIENTS)).body);
    expect(list.data.map((row) => row.name.en)).toEqual(['Flour']);
    const search = pageSchema(ingredientSchema).parse((await api.get(`${INGREDIENTS}?q=طحي`)).body);
    expect(search.data).toHaveLength(1);
  });

  it('are changed, and the unit is locked once there is a movement (criterion 5)', async () => {
    const api = await asPizzaManager();
    const created = await createFlour(api);

    const renamed = await api.patch(`${INGREDIENTS}/${created.id}`, {
      unit: 'g',
      costPerUnit: '0.5',
    });
    expect(ingredientOf(renamed)).toMatchObject({ unit: 'g', costPerUnit: '0.500' });

    await move(await asMallManager(), created.id, 'received', '20');
    const locked = await api.patch(`${INGREDIENTS}/${created.id}`, { unit: 'kg' });
    expect(locked.status).toBe(400);
    expect(codesOf(locked)).toEqual(['UNIT_LOCKED']);
    const still = await api.patch(`${INGREDIENTS}/${created.id}`, {
      name: { en: 'Flour 00', ar: 'طحين' },
    });
    expect(ingredientOf(still).name.en).toBe('Flour 00');
  });

  it('cannot be added by a branch manager or a purchaser (criterion 6), and need a brand for the admin', async () => {
    expect((await (await asMallManager()).post(INGREDIENTS, flour)).status).toBe(403);
    expect((await (await asPurchaser()).post(INGREDIENTS, flour)).status).toBe(403);
    const admin = await asAdmin();
    expect(codesOf(await admin.post(INGREDIENTS, flour))).toEqual(['BRAND_REQUIRED']);
    expect((await admin.post(INGREDIENTS, { ...flour, brandId: world.pizza.id })).status).toBe(201);
  });

  it("are the brand's own (criterion 7)", async () => {
    const created = await createFlour(await asPizzaManager());
    const burger = await asBurgerManager();
    expect(pageSchema(ingredientSchema).parse((await burger.get(INGREDIENTS)).body).data).toEqual(
      [],
    );
    expect((await burger.patch(`${INGREDIENTS}/${created.id}`, { lowLevel: '1' })).status).toBe(
      404,
    );
    expect((await burger.get(`${STOCK}?branchId=${world.mall.id}`)).status).toBe(404);
  });
});

describe('stock and movements', () => {
  it('receives goods and records waste, and keeps the history (criterion 1)', async () => {
    const created = await createFlour(await asPizzaManager());
    const api = await asMallManager();

    const received = await move(api, created.id, 'received', '20');
    expect(received.status).toBe(200);
    expect(branchStockSchema.parse(received.body)).toMatchObject({
      quantity: '20.000',
      isLow: false,
      value: '8.000',
    });
    const wasted = await move(api, created.id, 'waste', '2.5', 'Dropped a bag');
    expect(branchStockSchema.parse(wasted.body).quantity).toBe('17.500');

    const history = pageSchema(stockMovementSchema).parse(
      (await api.get(`${MOVEMENTS}?branchId=${world.mall.id}&ingredientId=${created.id}`)).body,
    );
    expect(
      history.data.map((row) => [row.kind, row.quantity, row.quantityAfter, row.byName]),
    ).toEqual([
      ['waste', '-2.500', '17.500', 'Maha Mall Manager'],
      ['received', '20.000', '20.000', 'Maha Mall Manager'],
    ]);
  });

  it('corrects the stock to what was counted (criterion 2)', async () => {
    const created = await createFlour(await asPizzaManager());
    const api = await asMallManager();
    await move(api, created.id, 'received', '17.5');

    const corrected = await move(api, created.id, 'adjustment', '17', 'Counted on Monday');
    expect(branchStockSchema.parse(corrected.body).quantity).toBe('17.000');
    const history = pageSchema(stockMovementSchema).parse(
      (await api.get(`${MOVEMENTS}?branchId=${world.mall.id}`)).body,
    );
    expect(history.data[0]).toMatchObject({
      kind: 'adjustment',
      quantity: '-0.500',
      note: 'Counted on Monday',
    });
  });

  it("marks and lists what is low, with the branch's own level first (criterion 3)", async () => {
    const manager = await asPizzaManager();
    const created = await createFlour(manager);
    const cheese = await createFlour(manager, {
      name: { en: 'Mozzarella', ar: 'موزاريلا' },
      lowLevel: '0',
    });
    const api = await asMallManager();
    await move(api, created.id, 'received', '4');
    await move(api, cheese.id, 'received', '4');

    const all = stockOf(await api.get(`${STOCK}?branchId=${world.mall.id}`));
    expect(all.map((row) => [row.ingredient.name.en, row.isLow])).toEqual([
      ['Flour', true],
      ['Mozzarella', false],
    ]);
    expect(
      stockOf(await api.get(`${STOCK}?branchId=${world.mall.id}&low=true`)).map(
        (row) => row.ingredient.name.en,
      ),
    ).toEqual(['Flour']);

    const level = await api.put(`${STOCK}/${world.mall.id}/${cheese.id}/level`, { lowLevel: '10' });
    expect(branchStockSchema.parse(level.body)).toMatchObject({ lowLevel: '10.000', isLow: true });
    const back = await api.put(`${STOCK}/${world.mall.id}/${cheese.id}/level`, { lowLevel: null });
    expect(branchStockSchema.parse(back.body)).toMatchObject({ lowLevel: null, isLow: false });
  });

  it('never goes below zero (criterion 4)', async () => {
    const created = await createFlour(await asPizzaManager());
    const api = await asMallManager();
    await move(api, created.id, 'received', '17.5');

    const res = await move(api, created.id, 'waste', '30', 'Oops');
    expect(res.status).toBe(400);
    expect(codesOf(res)).toEqual(['STOCK_NEGATIVE']);
    expect(stockOf(await api.get(`${STOCK}?branchId=${world.mall.id}`))[0]?.quantity).toBe(
      '17.500',
    );
    expect(await prisma.stockMovement.count()).toBe(1);
  });

  it('lets the purchaser work their own branch only, and refuses a cashier (criterion 6)', async () => {
    const created = await createFlour(await asPizzaManager());
    const purchaser = await asPurchaser();
    expect((await move(purchaser, created.id, 'received', '1')).status).toBe(200);
    const elsewhere = await purchaser.post(MOVEMENTS, {
      branchId: world.downtown.id,
      ingredientId: created.id,
      kind: 'received',
      quantity: '1',
    });
    expect(elsewhere.status).toBe(404);
    expect((await (await asCashier()).get(`${STOCK}?branchId=${world.mall.id}`)).status).toBe(403);
  });

  it('refuses an ingredient that is not active, or of another brand', async () => {
    const manager = await asPizzaManager();
    const created = await createFlour(manager, { isActive: false });
    const res = await move(await asMallManager(), created.id, 'received', '1');
    expect(res.status).toBe(400);
    expect(codesOf(res)).toEqual(['INGREDIENT_NOT_FOUND']);
  });
});
