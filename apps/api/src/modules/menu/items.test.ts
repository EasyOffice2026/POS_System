import { menuItemDetailSchema, menuItemSchema, pageSchema, searchTextOf } from '@pos/shared';
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

const ITEMS = '/api/v1/menu/items';
const asAdmin = async () => as(app, await signIn(app, 'admin@x.io'));
const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));
const asMallManager = async () => as(app, await signIn(app, 'mall-manager@x.io'));
const asCashier = async () => as(app, await signIn(app, 'cashier@x.io'));
const auditRows = (action: string) => prisma.auditLog.findMany({ where: { action } });

const itemPage = pageSchema(menuItemSchema);
const namesOf = (res: request.Response) =>
  itemPage.parse(res.body).data.map((item) => item.name.en);

function messagesOf(res: request.Response): string[] {
  return (errorOf(res).details ?? []).map((detail) => `${detail.path}:${detail.message}`);
}

// An item with names of our own, for the search tests.
function addItem(brandId: string, categoryId: string, en: string, ar: string, price = '10.000') {
  const name = { en, ar };
  return prisma.menuItem.create({
    data: { brandId, categoryId, name, searchText: searchTextOf(name), basePrice: price },
  });
}

async function cacheMenu(brandId: string, branchId: string) {
  await cache.set(brandId, branchId, '{"cached":true}', await cache.begin(brandId));
}

describe('GET /menu/items', () => {
  it('shows a brand manager the items of their brand, in the order of their English names', async () => {
    const api = await asPizzaManager();

    const res = await api.get(ITEMS);

    expect(res.status).toBe(200);
    expect(namesOf(res)).toEqual(['Cola', 'Margherita', 'Pepperoni']);
  });

  it('gives each price as text with three decimals', async () => {
    const api = await asPizzaManager();

    const res = await api.get(ITEMS);

    expect(itemPage.parse(res.body).data.map((item) => item.basePrice)).toEqual([
      '5.000',
      '20.000',
      '24.000',
    ]);
    const first = (res.body as { data: { basePrice: unknown }[] }).data[0];
    expect(typeof first?.basePrice).toBe('string');
  });

  it('shows a group admin every brand, or one brand when asked', async () => {
    const api = await asAdmin();

    expect(namesOf(await api.get(ITEMS))).toHaveLength(4);
    expect(namesOf(await api.get(`${ITEMS}?brandId=${world.burger.id}`))).toEqual(['Cheeseburger']);
  });

  it('shows nothing of another brand to a brand manager', async () => {
    const api = await asPizzaManager();

    const res = await api.get(`${ITEMS}?brandId=${world.burger.id}`);

    expect(itemPage.parse(res.body).data).toEqual([]);
  });

  it('lets a branch manager and a cashier read the menu of their brand', async () => {
    for (const api of [await asMallManager(), await asCashier()]) {
      expect(namesOf(await api.get(ITEMS))).toEqual(['Cola', 'Margherita', 'Pepperoni']);
    }
  });

  it('filters by category and by whether the item is active', async () => {
    const api = await asPizzaManager();
    await prisma.menuItem.update({
      where: { id: world.items.pepperoni.id },
      data: { isActive: false },
    });

    expect(namesOf(await api.get(`${ITEMS}?categoryId=${world.categories.pizzas.id}`))).toEqual([
      'Margherita',
      'Pepperoni',
    ]);
    expect(namesOf(await api.get(`${ITEMS}?status=active`))).toEqual(['Cola', 'Margherita']);
    expect(namesOf(await api.get(`${ITEMS}?status=inactive`))).toEqual(['Pepperoni']);
  });

  it('walks through the items in pages, with no repeats', async () => {
    const api = await asPizzaManager();
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const res: request.Response = await api.get(
        `${ITEMS}?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      );
      const page = itemPage.parse(res.body);
      seen.push(...page.data.map((item) => item.name.en));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);

    expect(seen).toEqual(['Cola', 'Margherita', 'Pepperoni']);
    expect(pages).toBe(2);
  });

  it('needs a signed-in person', async () => {
    const { default: supertest } = await import('supertest');

    expect((await supertest(app).get(ITEMS)).status).toBe(401);
  });
});

describe('searching items', () => {
  beforeEach(async () => {
    const pizzas = world.categories.pizzas.id;
    await addItem(world.pizza.id, pizzas, 'Spicy Chicken Pizza', 'بيتزا دجاج حار');
    await addItem(world.pizza.id, pizzas, 'Chicken Rice', 'أَرز بالدجاج');
    await addItem(world.pizza.id, pizzas, 'Half 50% off', 'نصف السعر');
    await addItem(world.burger.id, world.categories.burgers.id, 'Chicken Burger', 'برجر دجاج');
  });

  const search = async (q: string, path = ITEMS) => {
    const api = await asPizzaManager();
    return namesOf(await api.get(`${path}?q=${encodeURIComponent(q)}`));
  };

  it('finds an English name whatever the capital letters', async () => {
    expect(await search('MARGHERITA')).toEqual(['Margherita']);
    expect(await search('margh')).toEqual(['Margherita']);
  });

  it('finds items by an Arabic word in the Arabic name', async () => {
    expect(await search('بيتزا')).toEqual(['Spicy Chicken Pizza']);
  });

  it('ignores the marks on Arabic letters and the form of alef', async () => {
    // The stored name has marks, and the search has none, or another alef.
    expect(await search('ارز')).toEqual(['Chicken Rice']);
    expect(await search('أرز')).toEqual(['Chicken Rice']);
    expect(await search('إرز')).toEqual(['Chicken Rice']);
    expect(await search('أَرز')).toEqual(['Chicken Rice']);
  });

  it('finds part of an Arabic word', async () => {
    expect(await search('دجاج')).toEqual(['Chicken Rice', 'Spicy Chicken Pizza']);
  });

  it('wants every word typed, in any order', async () => {
    expect(await search('دجاج بيتزا')).toEqual(['Spicy Chicken Pizza']);
    expect(await search('pizza chicken')).toEqual(['Spicy Chicken Pizza']);
    expect(await search('chicken rice')).toEqual(['Chicken Rice']);
  });

  it('finds an item by either of its names', async () => {
    expect(await search('Half')).toEqual(['Half 50% off']);
    expect(await search('نصف')).toEqual(['Half 50% off']);
  });

  it('treats % and _ as the characters they are, not as wildcards', async () => {
    expect(await search('50%')).toEqual(['Half 50% off']);
    expect(await search('%')).toEqual(['Half 50% off']);
    expect(await search('_')).toEqual([]);
    expect(await search('a_c')).toEqual([]);
  });

  it('never finds an item of another brand', async () => {
    expect(await search('Burger')).toEqual([]);
    expect(await search('برجر')).toEqual([]);
  });

  it('does not look in descriptions', async () => {
    await prisma.menuItem.update({
      where: { id: world.items.cola.id },
      data: { description: { en: 'Served with lemon', ar: 'مع ليمون' } },
    });

    expect(await search('lemon')).toEqual([]);
  });

  it('works together with the other filters', async () => {
    const api = await asPizzaManager();

    const res = await api.get(
      `${ITEMS}?q=${encodeURIComponent('chicken')}&categoryId=${world.categories.drinks.id}`,
    );

    expect(namesOf(res)).toEqual([]);
  });

  it('refuses a search that is nothing but spaces, or too long', async () => {
    const api = await asPizzaManager();

    expect((await api.get(`${ITEMS}?q=%20%20`)).status).toBe(400);
    expect((await api.get(`${ITEMS}?q=${'x'.repeat(101)}`)).status).toBe(400);
  });
});

describe('GET /menu/items/:id', () => {
  it('shows an item with its modifier groups', async () => {
    const api = await asPizzaManager();

    const res = await api.get(`${ITEMS}/${world.items.margherita.id}`);

    expect(res.status).toBe(200);
    expect(menuItemDetailSchema.parse(res.body)).toMatchObject({
      name: { en: 'Margherita' },
      basePrice: '20.000',
      description: null,
      imageUrl: null,
      isActive: true,
      modifierGroups: [],
    });
  });

  it('is read by a cashier, who may read the menu', async () => {
    const api = await asCashier();

    expect((await api.get(`${ITEMS}/${world.items.margherita.id}`)).status).toBe(200);
  });

  it('answers the same for an item of another brand as for one that does not exist', async () => {
    const api = await asPizzaManager();

    const other = await api.get(`${ITEMS}/${world.items.cheeseburger.id}`);
    const missing = await api.get(`${ITEMS}/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b`);

    expect(other.status).toBe(404);
    expect(other.body).toEqual(missing.body);
  });
});

describe('POST /menu/items', () => {
  const name = { en: 'Tiramisu', ar: 'تيراميسو' };
  const body = () => ({ categoryId: world.categories.pizzas.id, name, basePrice: '22.5' });

  it('lets a brand manager add an item to their brand', async () => {
    const api = await asPizzaManager();

    const res = await api.post(ITEMS, body());

    expect(res.status).toBe(201);
    expect(menuItemDetailSchema.parse(res.body)).toMatchObject({
      brandId: world.pizza.id,
      categoryId: world.categories.pizzas.id,
      name,
      description: null,
      basePrice: '22.500',
      imageUrl: null,
      isActive: true,
      modifierGroups: [],
    });
  });

  it('stores the text that the item is searched by', async () => {
    const api = await asPizzaManager();

    const res = await api.post(ITEMS, { ...body(), name: { en: 'Tiramisu', ar: 'تِيراميسو' } });

    const stored = await prisma.menuItem.findUniqueOrThrow({
      where: { id: menuItemDetailSchema.parse(res.body).id },
    });
    expect(stored.searchText).toBe('tiramisu تيراميسو');
  });

  it('writes the creation to the audit log', async () => {
    const api = await asPizzaManager();

    const res = await api.post(ITEMS, body());

    const id = menuItemDetailSchema.parse(res.body).id;
    const [row] = await auditRows('menu.item.created');
    expect(row).toMatchObject({
      userId: world.users.pizzaManager.id,
      brandId: world.pizza.id,
      entityType: 'menu_item',
      entityId: id,
    });
    expect(row?.metadata).toEqual({
      name,
      categoryId: world.categories.pizzas.id,
      basePrice: '22.500',
    });
  });

  it('refuses an item with only an English name, and creates nothing', async () => {
    const api = await asPizzaManager();
    const before = await prisma.menuItem.count();

    const res = await api.post(ITEMS, { ...body(), name: { en: 'Tiramisu' } });

    expect(res.status).toBe(400);
    expect(errorOf(res).code).toBe('VALIDATION_ERROR');
    expect(messagesOf(res)).toEqual(['name.ar:NAME_REQUIRED']);
    expect(await prisma.menuItem.count()).toBe(before);
    expect(await auditRows('menu.item.created')).toHaveLength(0);
  });

  it.each([
    ['-1', 'basePrice:PRICE_INVALID'],
    ['abc', 'basePrice:PRICE_INVALID'],
    ['1.2345', 'basePrice:PRICE_INVALID'],
    ['10000000', 'basePrice:PRICE_INVALID'],
    [12.5, 'basePrice:PRICE_INVALID'],
  ])('refuses the price %j', async (basePrice, problem) => {
    const api = await asPizzaManager();

    const res = await api.post(ITEMS, { ...body(), basePrice });

    expect(messagesOf(res)).toEqual([problem]);
  });

  it('accepts a price of nothing', async () => {
    const api = await asPizzaManager();

    const res = await api.post(ITEMS, { ...body(), basePrice: '0' });

    expect(menuItemDetailSchema.parse(res.body).basePrice).toBe('0.000');
  });

  it('refuses a category of another brand, and one that does not exist', async () => {
    const api = await asPizzaManager();

    const other = await api.post(ITEMS, { ...body(), categoryId: world.categories.burgers.id });
    const missing = await api.post(ITEMS, {
      ...body(),
      categoryId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    });

    expect(messagesOf(other)).toEqual(['categoryId:CATEGORY_NOT_FOUND']);
    expect(messagesOf(missing)).toEqual(['categoryId:CATEGORY_NOT_FOUND']);
  });

  it('makes a group admin name the brand, and the category has to be in it', async () => {
    const api = await asAdmin();

    const missing = await api.post(ITEMS, body());
    const mixed = await api.post(ITEMS, { ...body(), brandId: world.burger.id });
    const right = await api.post(ITEMS, {
      ...body(),
      brandId: world.burger.id,
      categoryId: world.categories.burgers.id,
    });

    expect(messagesOf(missing)).toEqual(['brandId:BRAND_REQUIRED']);
    expect(messagesOf(mixed)).toEqual(['categoryId:CATEGORY_NOT_FOUND']);
    expect(right.status).toBe(201);
    expect(menuItemDetailSchema.parse(right.body).brandId).toBe(world.burger.id);
  });

  it('does not let a brand manager add to another brand', async () => {
    const api = await asPizzaManager();

    const res = await api.post(ITEMS, {
      ...body(),
      brandId: world.burger.id,
      categoryId: world.categories.burgers.id,
    });

    expect(res.status).toBe(403);
  });

  it('takes a description in both languages and a picture as a web link', async () => {
    const api = await asPizzaManager();

    const res = await api.post(ITEMS, {
      ...body(),
      description: { en: 'Coffee and cream', ar: 'قهوة وكريمة' },
      imageUrl: 'https://cdn.example.com/tiramisu.jpg',
    });

    expect(menuItemDetailSchema.parse(res.body)).toMatchObject({
      description: { en: 'Coffee and cream', ar: 'قهوة وكريمة' },
      imageUrl: 'https://cdn.example.com/tiramisu.jpg',
    });
  });

  it('refuses a description in one language, and a picture that is not a web link', async () => {
    const api = await asPizzaManager();

    const description = await api.post(ITEMS, { ...body(), description: { en: 'Only English' } });
    const image = await api.post(ITEMS, { ...body(), imageUrl: 'javascript:alert(1)' });

    expect(messagesOf(description)).toEqual(['description.ar:DESCRIPTION_REQUIRED']);
    expect(messagesOf(image)).toEqual(['imageUrl:IMAGE_URL_INVALID']);
  });

  it('can be added to a category that is not shown yet, and can start inactive', async () => {
    const api = await asPizzaManager();
    await prisma.menuCategory.update({
      where: { id: world.categories.pizzas.id },
      data: { isActive: false },
    });

    const res = await api.post(ITEMS, { ...body(), isActive: false });

    expect(res.status).toBe(201);
    expect(menuItemDetailSchema.parse(res.body).isActive).toBe(false);
  });

  it('refuses fields it does not know', async () => {
    const api = await asPizzaManager();

    expect((await api.post(ITEMS, { ...body(), sku: 'T-1' })).status).toBe(400);
  });

  it('is not allowed for a branch manager or a cashier', async () => {
    for (const api of [await asMallManager(), await asCashier()]) {
      const res = await api.post(ITEMS, body());

      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe('FORBIDDEN');
    }
  });

  it('clears the menus of the brand from the cache', async () => {
    await cacheMenu(world.pizza.id, world.mall.id);
    await cacheMenu(world.burger.id, world.airport.id);
    const api = await asPizzaManager();

    await api.post(ITEMS, body());

    expect(await cache.get(world.pizza.id, world.mall.id)).toBeNull();
    expect(await cache.get(world.burger.id, world.airport.id)).not.toBeNull();
  });
});

describe('PATCH /menu/items/:id', () => {
  const patch = (id: string) => `${ITEMS}/${id}`;

  it('changes the price, and the audit log says from what to what', async () => {
    const api = await asPizzaManager();

    const res = await api.patch(patch(world.items.margherita.id), { basePrice: '21.5' });

    expect(res.status).toBe(200);
    expect(menuItemDetailSchema.parse(res.body).basePrice).toBe('21.500');
    const [row] = await auditRows('menu.item.updated');
    expect(row).toMatchObject({
      brandId: world.pizza.id,
      entityType: 'menu_item',
      entityId: world.items.margherita.id,
    });
    expect(row?.metadata).toEqual({
      changed: ['basePrice'],
      basePrice: { from: '20.000', to: '21.500' },
    });
  });

  it('renames an item, and it is found by its new name and no longer by the old one', async () => {
    const api = await asPizzaManager();

    await api.patch(patch(world.items.margherita.id), { name: { en: 'Marinara', ar: 'مارينارا' } });

    expect(namesOf(await api.get(`${ITEMS}?q=marinara`))).toEqual(['Marinara']);
    expect(namesOf(await api.get(`${ITEMS}?q=مارينارا`))).toEqual(['Marinara']);
    expect(namesOf(await api.get(`${ITEMS}?q=margherita`))).toEqual([]);
  });

  it('moves an item to another category of the brand, and not to one of another brand', async () => {
    const api = await asPizzaManager();

    const moved = await api.patch(patch(world.items.cola.id), {
      categoryId: world.categories.pizzas.id,
    });
    const refused = await api.patch(patch(world.items.cola.id), {
      categoryId: world.categories.burgers.id,
    });

    expect(menuItemDetailSchema.parse(moved.body).categoryId).toBe(world.categories.pizzas.id);
    expect(messagesOf(refused)).toEqual(['categoryId:CATEGORY_NOT_FOUND']);
  });

  it('sets and clears the description and the picture', async () => {
    const api = await asPizzaManager();

    const set = await api.patch(patch(world.items.cola.id), {
      description: { en: 'Cold', ar: 'بارد' },
      imageUrl: 'https://cdn.example.com/cola.jpg',
    });
    const cleared = await api.patch(patch(world.items.cola.id), {
      description: null,
      imageUrl: null,
    });

    expect(menuItemDetailSchema.parse(set.body)).toMatchObject({
      description: { en: 'Cold', ar: 'بارد' },
      imageUrl: 'https://cdn.example.com/cola.jpg',
    });
    expect(menuItemDetailSchema.parse(cleared.body)).toMatchObject({
      description: null,
      imageUrl: null,
    });
  });

  it('deactivates an item and keeps it, so old orders keep its name and price', async () => {
    const api = await asPizzaManager();

    const res = await api.patch(patch(world.items.margherita.id), { isActive: false });

    expect(menuItemDetailSchema.parse(res.body).isActive).toBe(false);
    const stored = await prisma.menuItem.findUniqueOrThrow({
      where: { id: world.items.margherita.id },
    });
    expect(stored).toMatchObject({ name: { en: 'Margherita' }, isActive: false });
    expect(stored.basePrice.toFixed(3)).toBe('20.000');
    expect(namesOf(await api.get(`${ITEMS}?status=inactive`))).toEqual(['Margherita']);
    const [row] = await auditRows('menu.item.updated');
    expect(row?.metadata).toEqual({ changed: ['isActive'], isActive: false });
  });

  it('says nothing and writes nothing when nothing changes', async () => {
    const api = await asPizzaManager();
    await cacheMenu(world.pizza.id, world.mall.id);

    const res = await api.patch(patch(world.items.margherita.id), {
      name: { en: 'Margherita', ar: 'Margherita (ar)' },
      basePrice: '20',
      isActive: true,
    });

    expect(res.status).toBe(200);
    expect(await auditRows('menu.item.updated')).toHaveLength(0);
    expect(await cache.get(world.pizza.id, world.mall.id)).not.toBeNull();
  });

  it('refuses a request that changes nothing, and fields it does not know', async () => {
    const api = await asPizzaManager();

    expect(messagesOf(await api.patch(patch(world.items.cola.id), {}))).toEqual([
      ':NOTHING_TO_UPDATE',
    ]);
    expect((await api.patch(patch(world.items.cola.id), { brandId: world.burger.id })).status).toBe(
      400,
    );
  });

  it('answers that an item was not found for one of another brand', async () => {
    const api = await asPizzaManager();

    const other = await api.patch(patch(world.items.cheeseburger.id), { isActive: false });
    const missing = await api.patch(patch('0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'), {
      isActive: false,
    });

    expect(other.status).toBe(404);
    expect(other.body).toEqual(missing.body);
    expect(
      (await prisma.menuItem.findUniqueOrThrow({ where: { id: world.items.cheeseburger.id } }))
        .isActive,
    ).toBe(true);
  });

  it('is not allowed for a branch manager or a cashier', async () => {
    for (const api of [await asMallManager(), await asCashier()]) {
      const res = await api.patch(patch(world.items.cola.id), { isActive: false });

      expect(res.status).toBe(403);
    }
  });

  it('clears the menus of the brand from the cache', async () => {
    await cacheMenu(world.pizza.id, world.mall.id);
    await cacheMenu(world.pizza.id, world.downtown.id);
    const api = await asPizzaManager();

    await api.patch(patch(world.items.cola.id), { basePrice: '6' });

    expect(await cache.get(world.pizza.id, world.mall.id)).toBeNull();
    expect(await cache.get(world.pizza.id, world.downtown.id)).toBeNull();
  });
});
