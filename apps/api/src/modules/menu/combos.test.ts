import { comboSchema } from '@pos/shared';
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

const COMBOS = '/api/v1/menu/combos';
const asAdmin = async () => as(app, await signIn(app, 'admin@x.io'));
const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));
const asMallManager = async () => as(app, await signIn(app, 'mall-manager@x.io'));
const asCashier = async () => as(app, await signIn(app, 'cashier@x.io'));
const auditRows = (action: string) => prisma.auditLog.findMany({ where: { action } });

function messagesOf(res: request.Response): string[] {
  return (errorOf(res).details ?? []).map((detail) => `${detail.path}:${detail.message}`);
}

const listOf = (res: request.Response) =>
  (res.body as { data: unknown[] }).data.map((row) => comboSchema.parse(row));

async function cacheMenu(brandId: string, branchId: string) {
  await cache.set(brandId, branchId, '{"cached":true}', await cache.begin(brandId));
}

// A combo of a pizza and a drink.
const mealBody = () => ({
  name: { en: 'Pizza meal', ar: 'وجبة بيتزا' },
  price: '35',
  slots: [
    {
      name: { en: 'Pizza', ar: 'بيتزا' },
      options: [
        { itemId: world.items.margherita.id },
        { itemId: world.items.pepperoni.id, priceDelta: '3' },
      ],
    },
    { name: { en: 'Drink', ar: 'مشروب' }, options: [{ itemId: world.items.cola.id }] },
  ],
});

describe('POST /menu/combos', () => {
  it('adds a combo with a fixed price and slots that each list the items that can fill them', async () => {
    const api = await asPizzaManager();

    const res = await api.post(COMBOS, mealBody());

    expect(res.status).toBe(201);
    const combo = comboSchema.parse(res.body);
    expect(combo).toMatchObject({
      brandId: world.pizza.id,
      name: { en: 'Pizza meal' },
      price: '35.000',
      isActive: true,
    });
    expect(combo.slots.map((slot) => slot.name.en)).toEqual(['Pizza', 'Drink']);
    expect(combo.slots[0]?.options).toEqual([
      { itemId: world.items.margherita.id, priceDelta: '0.000' },
      { itemId: world.items.pepperoni.id, priceDelta: '3.000' },
    ]);
    expect(combo.slots[1]?.options).toEqual([{ itemId: world.items.cola.id, priceDelta: '0.000' }]);
  });

  it('writes the creation to the audit log', async () => {
    const api = await asPizzaManager();

    const res = await api.post(COMBOS, mealBody());

    const [row] = await auditRows('menu.combo.created');
    expect(row).toMatchObject({
      userId: world.users.pizzaManager.id,
      brandId: world.pizza.id,
      entityType: 'combo',
      entityId: comboSchema.parse(res.body).id,
    });
    expect(row?.metadata).toEqual({
      name: { en: 'Pizza meal', ar: 'وجبة بيتزا' },
      price: '35.000',
      slots: 2,
    });
  });

  it('refuses a combo with only an English name, and creates nothing', async () => {
    const api = await asPizzaManager();

    const res = await api.post(COMBOS, { ...mealBody(), name: { en: 'Pizza meal' } });

    expect(res.status).toBe(400);
    expect(messagesOf(res)).toEqual(['name.ar:NAME_REQUIRED']);
    expect(await prisma.combo.count()).toBe(0);
  });

  it('names an item of another brand, and one that does not exist, where it is in the combo', async () => {
    const api = await asPizzaManager();
    const body = mealBody();
    body.slots[0]?.options.push({ itemId: world.items.cheeseburger.id });
    body.slots[1]?.options.push({ itemId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' });

    const res = await api.post(COMBOS, body);

    expect(res.status).toBe(400);
    expect(messagesOf(res)).toEqual([
      'slots.0.options.2.itemId:ITEM_NOT_FOUND',
      'slots.1.options.1.itemId:ITEM_NOT_FOUND',
    ]);
    expect(await prisma.combo.count()).toBe(0);
  });

  it('refuses the same item twice in one slot, and a slot without an item', async () => {
    const api = await asPizzaManager();
    const twice = mealBody();
    twice.slots[0]?.options.push({ itemId: world.items.margherita.id });
    const empty = mealBody();
    empty.slots[1] = { name: { en: 'Drink', ar: 'مشروب' }, options: [] };

    expect(messagesOf(await api.post(COMBOS, twice))).toEqual([
      'slots.0.options.2.itemId:OPTION_DUPLICATE',
    ]);
    expect(messagesOf(await api.post(COMBOS, empty))).toEqual([
      'slots.1.options:SLOT_NEEDS_OPTION',
    ]);
  });

  it('allows the same item in two slots, and an item that is not active', async () => {
    const api = await asPizzaManager();
    await prisma.menuItem.update({ where: { id: world.items.cola.id }, data: { isActive: false } });
    const body = mealBody();
    body.slots.push({
      name: { en: 'Second drink', ar: 'مشروب ثان' },
      options: [{ itemId: world.items.cola.id }],
    });

    const res = await api.post(COMBOS, body);

    expect(res.status).toBe(201);
  });

  it('refuses a price that is not a price, and a combo with no slot', async () => {
    const api = await asPizzaManager();

    expect(messagesOf(await api.post(COMBOS, { ...mealBody(), price: '-1' }))).toEqual([
      'price:PRICE_INVALID',
    ]);
    expect(messagesOf(await api.post(COMBOS, { ...mealBody(), slots: [] }))).toEqual([
      'slots:COMBO_NEEDS_SLOT',
    ]);
  });

  it('makes a group admin name the brand', async () => {
    const api = await asAdmin();

    const missing = await api.post(COMBOS, mealBody());
    const chosen = await api.post(COMBOS, { ...mealBody(), brandId: world.pizza.id });

    expect(messagesOf(missing)).toEqual(['brandId:BRAND_REQUIRED']);
    expect(chosen.status).toBe(201);
  });

  it('does not let a brand manager add to another brand', async () => {
    const api = await asPizzaManager();

    const res = await api.post(COMBOS, { ...mealBody(), brandId: world.burger.id });

    expect(res.status).toBe(403);
  });

  it('is not allowed for a branch manager or a cashier', async () => {
    for (const api of [await asMallManager(), await asCashier()]) {
      const res = await api.post(COMBOS, mealBody());

      expect(res.status).toBe(403);
    }
  });

  it('clears the menus of the brand from the cache', async () => {
    await cacheMenu(world.pizza.id, world.mall.id);
    await cacheMenu(world.burger.id, world.airport.id);
    const api = await asPizzaManager();

    await api.post(COMBOS, mealBody());

    expect(await cache.get(world.pizza.id, world.mall.id)).toBeNull();
    expect(await cache.get(world.burger.id, world.airport.id)).not.toBeNull();
  });
});

describe('GET /menu/combos', () => {
  async function addMeal() {
    const api = await asPizzaManager();
    return comboSchema.parse((await api.post(COMBOS, mealBody())).body);
  }

  it('lists the combos of a brand with their slots', async () => {
    const meal = await addMeal();
    const api = await asPizzaManager();

    const rows = listOf(await api.get(COMBOS));

    expect(rows).toEqual([meal]);
  });

  it('shows a brand manager nothing of another brand, and a group admin every brand', async () => {
    await addMeal();

    expect(listOf(await (await asAdmin()).get(COMBOS))).toHaveLength(1);
    expect(
      listOf(await (await asPizzaManager()).get(`${COMBOS}?brandId=${world.burger.id}`)),
    ).toEqual([]);
  });

  it('filters by whether a combo is active', async () => {
    const meal = await addMeal();
    const api = await asPizzaManager();
    await api.patch(`${COMBOS}/${meal.id}`, { isActive: false });

    expect(listOf(await api.get(`${COMBOS}?status=active`))).toEqual([]);
    expect(listOf(await api.get(`${COMBOS}?status=inactive`))).toHaveLength(1);
  });

  it('lets a cashier read the combos of their brand', async () => {
    await addMeal();

    expect(listOf(await (await asCashier()).get(COMBOS))).toHaveLength(1);
  });

  it('shows one combo, and answers that one of another brand was not found', async () => {
    const meal = await addMeal();

    const own = await (await asPizzaManager()).get(`${COMBOS}/${meal.id}`);
    const other = await as(app, await signIn(app, 'burger@x.io')).get(`${COMBOS}/${meal.id}`);

    expect(comboSchema.parse(own.body)).toEqual(meal);
    expect(other.status).toBe(404);
  });
});

describe('PATCH /menu/combos/:id', () => {
  async function addMeal() {
    const api = await asPizzaManager();
    return comboSchema.parse((await api.post(COMBOS, mealBody())).body);
  }

  it('changes the price, and the audit log says from what to what', async () => {
    const meal = await addMeal();
    const api = await asPizzaManager();

    const res = await api.patch(`${COMBOS}/${meal.id}`, { price: '38.5' });

    expect(comboSchema.parse(res.body).price).toBe('38.500');
    const [row] = await auditRows('menu.combo.updated');
    expect(row?.metadata).toEqual({
      changed: ['price'],
      price: { from: '35.000', to: '38.500' },
    });
  });

  it('renames a combo and deactivates it, keeping it', async () => {
    const meal = await addMeal();
    const api = await asPizzaManager();

    await api.patch(`${COMBOS}/${meal.id}`, { name: { en: 'Big meal', ar: 'وجبة كبيرة' } });
    const off = await api.patch(`${COMBOS}/${meal.id}`, { isActive: false });

    expect(comboSchema.parse(off.body)).toMatchObject({
      name: { en: 'Big meal' },
      isActive: false,
    });
    expect(await prisma.combo.count()).toBe(1);
  });

  it('replaces the slots when new ones are sent, and the old options go with them', async () => {
    const meal = await addMeal();
    const api = await asPizzaManager();

    const res = await api.patch(`${COMBOS}/${meal.id}`, {
      slots: [{ name: { en: 'Drink', ar: 'مشروب' }, options: [{ itemId: world.items.cola.id }] }],
    });

    const changed = comboSchema.parse(res.body);
    expect(changed.slots).toHaveLength(1);
    expect(changed.slots[0]?.name.en).toBe('Drink');
    expect(await prisma.comboSlot.count()).toBe(1);
    expect(await prisma.comboSlotOption.count()).toBe(1);
    const [row] = await auditRows('menu.combo.updated');
    expect(row?.metadata).toEqual({ changed: ['slots'] });
  });

  it('checks the items of new slots, and keeps the old slots when one is wrong', async () => {
    const meal = await addMeal();
    const api = await asPizzaManager();

    const res = await api.patch(`${COMBOS}/${meal.id}`, {
      slots: [
        {
          name: { en: 'Burger', ar: 'برجر' },
          options: [{ itemId: world.items.cheeseburger.id }],
        },
      ],
    });

    expect(messagesOf(res)).toEqual(['slots.0.options.0.itemId:ITEM_NOT_FOUND']);
    expect(await prisma.comboSlot.count()).toBe(2);
    expect(await prisma.comboSlotOption.count()).toBe(3);
  });

  it('says nothing and writes nothing when the combo is as asked', async () => {
    const meal = await addMeal();
    const api = await asPizzaManager();
    await cacheMenu(world.pizza.id, world.mall.id);

    const res = await api.patch(`${COMBOS}/${meal.id}`, {
      price: '35',
      name: { en: 'Pizza meal', ar: 'وجبة بيتزا' },
      slots: mealBody().slots,
    });

    expect(res.status).toBe(200);
    expect(comboSchema.parse(res.body)).toEqual(meal);
    expect(await auditRows('menu.combo.updated')).toHaveLength(0);
    expect(await cache.get(world.pizza.id, world.mall.id)).not.toBeNull();
  });

  it('refuses a request that changes nothing', async () => {
    const meal = await addMeal();
    const api = await asPizzaManager();

    expect(messagesOf(await api.patch(`${COMBOS}/${meal.id}`, {}))).toEqual([':NOTHING_TO_UPDATE']);
  });

  it('answers that a combo was not found for one of another brand', async () => {
    const meal = await addMeal();
    const api = as(app, await signIn(app, 'burger@x.io'));

    expect((await api.patch(`${COMBOS}/${meal.id}`, { isActive: false })).status).toBe(404);
  });

  it('is not allowed for a branch manager or a cashier', async () => {
    const meal = await addMeal();

    for (const api of [await asMallManager(), await asCashier()]) {
      expect((await api.patch(`${COMBOS}/${meal.id}`, { isActive: false })).status).toBe(403);
    }
  });

  it('clears the menus of the brand from the cache', async () => {
    const meal = await addMeal();
    await cacheMenu(world.pizza.id, world.mall.id);
    const api = await asPizzaManager();

    await api.patch(`${COMBOS}/${meal.id}`, { price: '40' });

    expect(await cache.get(world.pizza.id, world.mall.id)).toBeNull();
  });
});
