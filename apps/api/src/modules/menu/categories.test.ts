import { MAX_CATEGORIES, menuCategorySchema } from '@pos/shared';
import type request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { createMenuWorld, type MenuWorld } from '../../../test/menu-world';
import { as, errorOf, signIn } from '../../../test/users-world';
import { createMemoryMenuCache } from '../../lib/menu-cache';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const cache = createMemoryMenuCache();
const app = createApp({
  prisma,
  config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }),
  menuCache: cache,
});

let world: MenuWorld;

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  world = await createMenuWorld(prisma, hasher);
});

const CATEGORIES = '/api/v1/menu/categories';
const asAdmin = async () => as(app, await signIn(app, 'admin@x.io'));
const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));
const asMallManager = async () => as(app, await signIn(app, 'mall-manager@x.io'));
const asCashier = async () => as(app, await signIn(app, 'cashier@x.io'));
const auditRows = (action: string) => prisma.auditLog.findMany({ where: { action } });

const data = (res: request.Response) =>
  (res.body as { data: unknown[] }).data.map((row) => menuCategorySchema.parse(row));
const names = (res: request.Response) => data(res).map((category) => category.name.en);

function messagesOf(res: request.Response): string[] {
  return (errorOf(res).details ?? []).map((detail) => `${detail.path}:${detail.message}`);
}

// Puts a menu in the cache of a branch, to see whether a change clears it.
async function cacheMenu(brandId: string, branchId: string) {
  await cache.set(brandId, branchId, '{"cached":true}', await cache.begin(brandId));
}

describe('GET /menu/categories', () => {
  it('shows a brand manager the categories of their brand, in the order they are shown', async () => {
    const api = await asPizzaManager();

    const res = await api.get(CATEGORIES);

    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Pizzas', 'Drinks']);
  });

  it('shows a group admin every brand, or one brand when asked', async () => {
    const api = await asAdmin();

    expect(names(await api.get(CATEGORIES)).sort()).toEqual(['Burgers', 'Drinks', 'Pizzas']);
    expect(names(await api.get(`${CATEGORIES}?brandId=${world.burger.id}`))).toEqual(['Burgers']);
  });

  it('shows nothing of another brand to a brand manager who asks for it', async () => {
    const api = await asPizzaManager();

    const res = await api.get(`${CATEGORIES}?brandId=${world.burger.id}`);

    expect(res.status).toBe(200);
    expect(data(res)).toEqual([]);
  });

  it('lets a branch manager and a cashier read the menu of their brand', async () => {
    for (const api of [await asMallManager(), await asCashier()]) {
      expect(names(await api.get(CATEGORIES))).toEqual(['Pizzas', 'Drinks']);
    }
  });

  it('filters by whether a category is active', async () => {
    const api = await asPizzaManager();
    await prisma.menuCategory.update({
      where: { id: world.categories.drinks.id },
      data: { isActive: false },
    });

    expect(names(await api.get(`${CATEGORIES}?status=active`))).toEqual(['Pizzas']);
    expect(names(await api.get(`${CATEGORIES}?status=inactive`))).toEqual(['Drinks']);
    expect(names(await api.get(CATEGORIES))).toEqual(['Pizzas', 'Drinks']);
  });

  it('puts the categories in the order that was set', async () => {
    const api = await asPizzaManager();
    await prisma.menuCategory.update({
      where: { id: world.categories.pizzas.id },
      data: { sortOrder: 5 },
    });

    expect(names(await api.get(CATEGORIES))).toEqual(['Drinks', 'Pizzas']);
  });
});

describe('POST /menu/categories', () => {
  const name = { en: 'Desserts', ar: 'حلويات' };

  it('lets a brand manager add a category to their brand, at the end', async () => {
    const api = await asPizzaManager();

    const res = await api.post(CATEGORIES, { name });

    expect(res.status).toBe(201);
    expect(menuCategorySchema.parse(res.body)).toMatchObject({
      brandId: world.pizza.id,
      name,
      sortOrder: 2,
      isActive: true,
    });
    expect(names(await api.get(CATEGORIES))).toEqual(['Pizzas', 'Drinks', 'Desserts']);
  });

  it('writes the creation to the audit log', async () => {
    const api = await asPizzaManager();

    const res = await api.post(CATEGORIES, { name });

    const id = menuCategorySchema.parse(res.body).id;
    const [row] = await auditRows('menu.category.created');
    expect(row).toMatchObject({
      userId: world.users.pizzaManager.id,
      brandId: world.pizza.id,
      entityType: 'menu_category',
      entityId: id,
    });
    expect(row?.metadata).toEqual({ name, isActive: true });
  });

  it('can start a category as inactive, to be set up before it is shown', async () => {
    const api = await asPizzaManager();

    const res = await api.post(CATEGORIES, { name, isActive: false });

    expect(menuCategorySchema.parse(res.body).isActive).toBe(false);
  });

  it('makes a group admin name the brand', async () => {
    const api = await asAdmin();

    const missing = await api.post(CATEGORIES, { name });
    const unknown = await api.post(CATEGORIES, {
      name,
      brandId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    });
    const chosen = await api.post(CATEGORIES, { name, brandId: world.burger.id });

    expect(messagesOf(missing)).toEqual(['brandId:BRAND_REQUIRED']);
    expect(messagesOf(unknown)).toEqual(['brandId:BRAND_NOT_FOUND']);
    expect(chosen.status).toBe(201);
    expect(menuCategorySchema.parse(chosen.body)).toMatchObject({
      brandId: world.burger.id,
      sortOrder: 1,
    });
  });

  it('does not let a brand manager add to another brand', async () => {
    const api = await asPizzaManager();

    const res = await api.post(CATEGORIES, { name, brandId: world.burger.id });

    expect(res.status).toBe(403);
    expect(await prisma.menuCategory.count({ where: { brandId: world.burger.id } })).toBe(1);
  });

  it('refuses a name with only an English value, and creates nothing', async () => {
    const api = await asPizzaManager();

    const res = await api.post(CATEGORIES, { name: { en: 'Desserts' } });

    expect(res.status).toBe(400);
    expect(messagesOf(res)).toEqual(['name.ar:NAME_REQUIRED']);
    expect(await auditRows('menu.category.created')).toHaveLength(0);
  });

  it('is not allowed for a branch manager or a cashier', async () => {
    for (const api of [await asMallManager(), await asCashier()]) {
      const res = await api.post(CATEGORIES, { name });

      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe('FORBIDDEN');
    }
  });

  it('clears the menus of the brand from the cache, and only that brand', async () => {
    await cacheMenu(world.pizza.id, world.mall.id);
    await cacheMenu(world.burger.id, world.airport.id);
    const api = await asPizzaManager();

    await api.post(CATEGORIES, { name });

    expect(await cache.get(world.pizza.id, world.mall.id)).toBeNull();
    expect(await cache.get(world.burger.id, world.airport.id)).not.toBeNull();
  });

  it('stops at the most categories a brand can have', async () => {
    const api = await asPizzaManager();
    const have = await prisma.menuCategory.count({ where: { brandId: world.pizza.id } });
    await prisma.menuCategory.createMany({
      data: Array.from({ length: MAX_CATEGORIES - have }, (_, index) => ({
        brandId: world.pizza.id,
        name: { en: `Extra ${index}`, ar: `إضافي ${index}` },
        sortOrder: 10 + index,
      })),
    });

    const res = await api.post(CATEGORIES, { name });

    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('CATEGORY_LIMIT');
  });
});

describe('PATCH /menu/categories/:id', () => {
  const patch = (id: string) => `${CATEGORIES}/${id}`;

  it('renames a category, and lists what changed in the audit log', async () => {
    const api = await asPizzaManager();
    const name = { en: 'Pizza', ar: 'البيتزا' };

    const res = await api.patch(patch(world.categories.pizzas.id), { name });

    expect(res.status).toBe(200);
    expect(menuCategorySchema.parse(res.body).name).toEqual(name);
    const [row] = await auditRows('menu.category.updated');
    expect(row).toMatchObject({
      brandId: world.pizza.id,
      entityType: 'menu_category',
      entityId: world.categories.pizzas.id,
    });
    expect(row?.metadata).toEqual({ changed: ['name'] });
  });

  it('deactivates a category and keeps it, so old orders keep its name', async () => {
    const api = await asPizzaManager();

    const res = await api.patch(patch(world.categories.pizzas.id), { isActive: false });

    expect(menuCategorySchema.parse(res.body).isActive).toBe(false);
    const stored = await prisma.menuCategory.findUniqueOrThrow({
      where: { id: world.categories.pizzas.id },
    });
    expect(stored.name).toEqual({ en: 'Pizzas', ar: 'Pizzas (ar)' });
    const [row] = await auditRows('menu.category.updated');
    expect(row?.metadata).toEqual({ changed: ['isActive'], isActive: false });
  });

  it('activates it again', async () => {
    const api = await asPizzaManager();
    await api.patch(patch(world.categories.pizzas.id), { isActive: false });

    const res = await api.patch(patch(world.categories.pizzas.id), { isActive: true });

    expect(menuCategorySchema.parse(res.body).isActive).toBe(true);
  });

  it('says nothing and writes nothing when nothing changes', async () => {
    const api = await asPizzaManager();
    await cacheMenu(world.pizza.id, world.mall.id);

    const res = await api.patch(patch(world.categories.pizzas.id), {
      name: { en: 'Pizzas', ar: 'Pizzas (ar)' },
      isActive: true,
    });

    expect(res.status).toBe(200);
    expect(await auditRows('menu.category.updated')).toHaveLength(0);
    expect(await cache.get(world.pizza.id, world.mall.id)).not.toBeNull();
  });

  it('refuses a request that changes nothing at all, and a name with one language', async () => {
    const api = await asPizzaManager();

    expect(messagesOf(await api.patch(patch(world.categories.pizzas.id), {}))).toEqual([
      ':NOTHING_TO_UPDATE',
    ]);
    expect(
      messagesOf(await api.patch(patch(world.categories.pizzas.id), { name: { en: 'Pizza' } })),
    ).toEqual(['name.ar:NAME_REQUIRED']);
  });

  it('answers that a category was not found for one of another brand', async () => {
    const api = await asPizzaManager();

    const other = await api.patch(patch(world.categories.burgers.id), { isActive: false });
    const missing = await api.patch(patch('0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'), {
      isActive: false,
    });

    expect(other.status).toBe(404);
    expect(other.body).toEqual(missing.body);
    expect(
      (await prisma.menuCategory.findUniqueOrThrow({ where: { id: world.categories.burgers.id } }))
        .isActive,
    ).toBe(true);
  });

  it('is not allowed for a branch manager or a cashier', async () => {
    for (const api of [await asMallManager(), await asCashier()]) {
      const res = await api.patch(patch(world.categories.pizzas.id), { isActive: false });

      expect(res.status).toBe(403);
    }
  });

  it('clears the menus of the brand from the cache', async () => {
    await cacheMenu(world.pizza.id, world.mall.id);
    const api = await asPizzaManager();

    await api.patch(patch(world.categories.pizzas.id), { isActive: false });

    expect(await cache.get(world.pizza.id, world.mall.id)).toBeNull();
  });
});

describe('PUT /menu/categories/order', () => {
  const ORDER = `${CATEGORIES}/order`;

  it('puts the categories of a brand in a new order', async () => {
    const api = await asPizzaManager();

    const res = await api.put(ORDER, {
      ids: [world.categories.drinks.id, world.categories.pizzas.id],
    });

    expect(res.status).toBe(200);
    expect(data(res).map((category) => [category.name.en, category.sortOrder])).toEqual([
      ['Drinks', 0],
      ['Pizzas', 1],
    ]);
    expect(names(await api.get(CATEGORIES))).toEqual(['Drinks', 'Pizzas']);
  });

  it('writes the new order to the audit log, and clears the cache', async () => {
    await cacheMenu(world.pizza.id, world.mall.id);
    const api = await asPizzaManager();

    await api.put(ORDER, { ids: [world.categories.drinks.id, world.categories.pizzas.id] });

    const [row] = await auditRows('menu.category.reordered');
    expect(row).toMatchObject({ brandId: world.pizza.id, userId: world.users.pizzaManager.id });
    expect(row?.metadata).toEqual({ count: 2 });
    expect(await cache.get(world.pizza.id, world.mall.id)).toBeNull();
  });

  it('includes categories that are not active, because they have a place too', async () => {
    const api = await asPizzaManager();
    await api.patch(`${CATEGORIES}/${world.categories.pizzas.id}`, { isActive: false });

    const res = await api.put(ORDER, {
      ids: [world.categories.drinks.id, world.categories.pizzas.id],
    });

    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Drinks', 'Pizzas']);
  });

  it('says nothing and writes nothing when the order is the same', async () => {
    const api = await asPizzaManager();

    const res = await api.put(ORDER, {
      ids: [world.categories.pizzas.id, world.categories.drinks.id],
    });

    expect(res.status).toBe(200);
    expect(await auditRows('menu.category.reordered')).toHaveLength(0);
  });

  it('refuses a list that leaves a category out, or has one of another brand', async () => {
    const api = await asPizzaManager();

    const fewer = await api.put(ORDER, { ids: [world.categories.pizzas.id] });
    const other = await api.put(ORDER, {
      ids: [world.categories.pizzas.id, world.categories.burgers.id],
    });

    expect(messagesOf(fewer)).toEqual(['ids:ORDER_MISMATCH']);
    expect(messagesOf(other)).toEqual(['ids:ORDER_MISMATCH']);
    expect(names(await api.get(CATEGORIES))).toEqual(['Pizzas', 'Drinks']);
  });

  it('refuses the same category twice', async () => {
    const api = await asPizzaManager();

    const res = await api.put(ORDER, {
      ids: [world.categories.pizzas.id, world.categories.pizzas.id],
    });

    expect(messagesOf(res)).toEqual(['ids:ORDER_DUPLICATE']);
  });

  it('makes a group admin name the brand', async () => {
    const api = await asAdmin();

    const missing = await api.put(ORDER, { ids: [world.categories.burgers.id] });
    const chosen = await api.put(ORDER, {
      brandId: world.burger.id,
      ids: [world.categories.burgers.id],
    });

    expect(messagesOf(missing)).toEqual(['brandId:BRAND_REQUIRED']);
    expect(chosen.status).toBe(200);
  });

  it('is not allowed for a branch manager or a cashier', async () => {
    for (const api of [await asMallManager(), await asCashier()]) {
      const res = await api.put(ORDER, {
        ids: [world.categories.drinks.id, world.categories.pizzas.id],
      });

      expect(res.status).toBe(403);
    }
  });
});
