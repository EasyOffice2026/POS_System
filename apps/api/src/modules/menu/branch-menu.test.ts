import {
  type BranchMenu,
  branchMenuSchema,
  closedWeek,
  type OpeningHours,
  searchTextOf,
} from '@pos/shared';
import request from 'supertest';
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
const config = testConfig({ AUTH_RATE_LIMIT_MAX: '1000' });
const cache = createMemoryMenuCache();
const app = createApp({ prisma, config, menuCache: cache });

let world: MenuWorld;

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  world = await createMenuWorld(prisma, hasher);
});

const MENU = '/api/v1/menu';
const asAdmin = async () => as(app, await signIn(app, 'admin@x.io'));
const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));
const asBurgerManager = async () => as(app, await signIn(app, 'burger@x.io'));
const asMallManager = async () => as(app, await signIn(app, 'mall-manager@x.io'));
const asCashier = async () => as(app, await signIn(app, 'cashier@x.io'));

const load = (api: ReturnType<typeof as>, branchId: string) =>
  api.get(`${MENU}?branchId=${branchId}`);
const menuOf = (res: request.Response): BranchMenu => branchMenuSchema.parse(res.body);
const itemNames = (menu: BranchMenu) =>
  menu.categories.map((category) => [category.name.en, category.items.map((item) => item.name.en)]);
const priceOf = (menu: BranchMenu, itemId: string) =>
  menu.categories.flatMap((category) => category.items).find((item) => item.id === itemId)?.price;

const week = (days: Partial<OpeningHours>): OpeningHours => ({ ...closedWeek(), ...days });

async function setOverride(
  itemId: string,
  branchId: string,
  data: { priceOverride?: string; isAvailable?: boolean; schedule?: OpeningHours },
) {
  await prisma.branchMenuItem.create({
    data: { itemId, branchId, brandId: world.pizza.id, ...data },
  });
  await cache.invalidate(world.pizza.id, branchId);
}

describe('GET /menu?branchId=', () => {
  it('gives the menu of a branch as a terminal loads it', async () => {
    const api = await asPizzaManager();

    const res = await load(api, world.mall.id);

    expect(res.status).toBe(200);
    expect(res.type).toBe('application/json');
    const menu = menuOf(res);
    expect(menu).toMatchObject({
      branchId: world.mall.id,
      brandId: world.pizza.id,
      currency: 'KWD',
      timezone: 'Asia/Kuwait',
      combos: [],
    });
    expect(itemNames(menu)).toEqual([
      ['Pizzas', ['Margherita', 'Pepperoni']],
      ['Drinks', ['Cola']],
    ]);
  });

  it('sends each price as text with three decimals, and nothing that is only for managers', async () => {
    const api = await asPizzaManager();

    const res = await load(api, world.mall.id);

    const prices = menuOf(res).categories.flatMap((category) =>
      category.items.map((item) => item.price),
    );
    expect(prices).toEqual(['20.000', '24.000', '5.000']);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('searchText');
    expect(text).not.toContain('basePrice');
    expect(text).not.toContain('isActive');
  });

  it('shows the price of the branch where it has one, and the brand price at the others', async () => {
    await setOverride(world.items.margherita.id, world.mall.id, { priceOverride: '22.500' });
    const api = await asPizzaManager();

    const mall = menuOf(await load(api, world.mall.id));
    const downtown = menuOf(await load(api, world.downtown.id));

    expect(priceOf(mall, world.items.margherita.id)).toBe('22.500');
    expect(priceOf(downtown, world.items.margherita.id)).toBe('20.000');
  });

  it('leaves out an item that one branch has switched off, and keeps it in the others', async () => {
    await setOverride(world.items.pepperoni.id, world.mall.id, { isAvailable: false });
    const api = await asPizzaManager();

    const mall = menuOf(await load(api, world.mall.id));
    const downtown = menuOf(await load(api, world.downtown.id));

    expect(itemNames(mall)[0]).toEqual(['Pizzas', ['Margherita']]);
    expect(itemNames(downtown)[0]).toEqual(['Pizzas', ['Margherita', 'Pepperoni']]);
  });

  it('leaves out items that are not active, and the items of a category that is not active', async () => {
    await prisma.menuItem.update({ where: { id: world.items.cola.id }, data: { isActive: false } });
    await prisma.menuCategory.update({
      where: { id: world.categories.pizzas.id },
      data: { isActive: false },
    });
    const api = await asPizzaManager();

    const menu = menuOf(await load(api, world.mall.id));

    expect(menu.categories).toEqual([]);
  });

  it('leaves out a category with nothing left to sell at the branch', async () => {
    await setOverride(world.items.cola.id, world.mall.id, { isAvailable: false });
    const api = await asPizzaManager();

    const mall = menuOf(await load(api, world.mall.id));
    const downtown = menuOf(await load(api, world.downtown.id));

    expect(mall.categories.map((category) => category.name.en)).toEqual(['Pizzas']);
    expect(downtown.categories.map((category) => category.name.en)).toEqual(['Pizzas', 'Drinks']);
  });

  it('follows the order of the categories that was set', async () => {
    await prisma.menuCategory.update({
      where: { id: world.categories.pizzas.id },
      data: { sortOrder: 9 },
    });
    const api = await asPizzaManager();

    const menu = menuOf(await load(api, world.mall.id));

    expect(menu.categories.map((category) => category.name.en)).toEqual(['Drinks', 'Pizzas']);
  });

  it('sends the schedule of an item, and no schedule for an item that has none', async () => {
    await setOverride(world.items.pepperoni.id, world.mall.id, {
      schedule: week({
        monday: {
          kind: 'ranges',
          ranges: [
            { open: '18:00', close: '23:00' },
            { open: '11:00', close: '15:00' },
          ],
        },
      }),
    });
    const api = await asPizzaManager();

    const menu = menuOf(await load(api, world.mall.id));

    const items = menu.categories.flatMap((category) => category.items);
    expect(items.find((item) => item.id === world.items.margherita.id)?.schedule).toBeNull();
    expect(items.find((item) => item.id === world.items.pepperoni.id)?.schedule?.monday).toEqual({
      kind: 'ranges',
      ranges: [
        { open: '11:00', close: '15:00' },
        { open: '18:00', close: '23:00' },
      ],
    });
  });

  it('sends the time zone of the branch, so the schedule is read on its clock', async () => {
    await prisma.branch.update({ where: { id: world.mall.id }, data: { timezone: 'Asia/Dubai' } });
    const api = await asPizzaManager();

    expect(menuOf(await load(api, world.mall.id)).timezone).toBe('Asia/Dubai');
  });

  it('gives the description and the picture of an item', async () => {
    await prisma.menuItem.update({
      where: { id: world.items.cola.id },
      data: {
        description: { en: 'Cold', ar: 'بارد' },
        imageUrl: 'https://cdn.example.com/cola.jpg',
      },
    });
    const api = await asPizzaManager();

    const menu = menuOf(await load(api, world.mall.id));

    const cola = menu.categories
      .flatMap((category) => category.items)
      .find((item) => item.name.en === 'Cola');
    expect(cola).toMatchObject({
      description: { en: 'Cold', ar: 'بارد' },
      imageUrl: 'https://cdn.example.com/cola.jpg',
    });
  });
});

describe('the choices of an item in the menu of a branch', () => {
  async function makeGroup(
    name: string,
    minSelect: number,
    maxSelect: number,
    modifiers: { name: string; delta: string; isActive?: boolean }[],
    isActive = true,
  ) {
    const group = await prisma.modifierGroup.create({
      data: {
        brandId: world.pizza.id,
        itemId: world.items.margherita.id,
        name: { en: name, ar: `${name} (ar)` },
        minSelect,
        maxSelect,
        isActive,
      },
    });
    await prisma.modifier.createMany({
      data: modifiers.map((modifier, index) => ({
        brandId: world.pizza.id,
        groupId: group.id,
        name: { en: modifier.name, ar: `${modifier.name} (ar)` },
        priceDelta: modifier.delta,
        isActive: modifier.isActive ?? true,
        sortOrder: index,
      })),
    });
  }

  const margherita = (menu: BranchMenu) =>
    menu.categories
      .flatMap((category) => category.items)
      .find((item) => item.name.en === 'Margherita');

  it('has each group with its modifiers, in order, with the smallest and largest choice', async () => {
    await makeGroup('Size', 1, 1, [
      { name: 'Small', delta: '-3' },
      { name: 'Large', delta: '4' },
    ]);
    const api = await asPizzaManager();

    const menu = menuOf(await load(api, world.mall.id));

    const [size] = margherita(menu)?.modifierGroups ?? [];
    expect(size).toMatchObject({ name: { en: 'Size' }, minSelect: 1, maxSelect: 1 });
    expect(size?.modifiers.map((modifier) => [modifier.name.en, modifier.priceDelta])).toEqual([
      ['Small', '-3.000'],
      ['Large', '4.000'],
    ]);
  });

  it('leaves out groups and modifiers that are not active', async () => {
    await makeGroup('Size', 1, 1, [
      { name: 'Small', delta: '0' },
      { name: 'Huge', delta: '9', isActive: false },
    ]);
    await makeGroup('Old extras', 0, 2, [{ name: 'Anchovies', delta: '1' }], false);
    const api = await asPizzaManager();

    const menu = menuOf(await load(api, world.mall.id));

    const groups = margherita(menu)?.modifierGroups ?? [];
    expect(groups.map((group) => group.name.en)).toEqual(['Size']);
    expect(groups[0]?.modifiers.map((modifier) => modifier.name.en)).toEqual(['Small']);
  });

  it('leaves out a group with nothing left to choose from', async () => {
    await makeGroup('Extras', 0, 2, [{ name: 'Olives', delta: '1', isActive: false }]);
    await makeGroup('Empty', 0, 1, []);
    const api = await asPizzaManager();

    const menu = menuOf(await load(api, world.mall.id));

    expect(margherita(menu)?.modifierGroups).toEqual([]);
  });
});

describe('the combos in the menu of a branch', () => {
  async function makeCombo(options: { itemId: string; priceDelta?: string }[][], isActive = true) {
    const combo = await prisma.combo.create({
      data: {
        brandId: world.pizza.id,
        name: { en: 'Meal', ar: 'وجبة' },
        price: '35.000',
        isActive,
      },
    });
    for (const [index, slotOptions] of options.entries()) {
      const slot = await prisma.comboSlot.create({
        data: {
          brandId: world.pizza.id,
          comboId: combo.id,
          name: { en: `Slot ${index}`, ar: 'خانة' },
          sortOrder: index,
        },
      });
      await prisma.comboSlotOption.createMany({
        data: slotOptions.map((option, position) => ({
          slotId: slot.id,
          itemId: option.itemId,
          brandId: world.pizza.id,
          priceDelta: option.priceDelta ?? '0.000',
          sortOrder: position,
        })),
      });
    }
    return combo;
  }

  it('has the combo with its price and the choices of each slot', async () => {
    const combo = await makeCombo([
      [
        { itemId: world.items.margherita.id },
        { itemId: world.items.pepperoni.id, priceDelta: '3' },
      ],
      [{ itemId: world.items.cola.id }],
    ]);
    const api = await asPizzaManager();

    const menu = menuOf(await load(api, world.mall.id));

    expect(menu.combos).toHaveLength(1);
    expect(menu.combos[0]).toMatchObject({ id: combo.id, name: { en: 'Meal' }, price: '35.000' });
    expect(
      menu.combos[0]?.slots.map((slot) => slot.options.map((option) => option.itemId)),
    ).toEqual([[world.items.margherita.id, world.items.pepperoni.id], [world.items.cola.id]]);
    expect(menu.combos[0]?.slots[0]?.options[1]?.priceDelta).toBe('3.000');
  });

  it('takes out the choices that this branch cannot sell, and keeps them at the other branches', async () => {
    await makeCombo([
      [{ itemId: world.items.margherita.id }, { itemId: world.items.pepperoni.id }],
      [{ itemId: world.items.cola.id }],
    ]);
    await setOverride(world.items.pepperoni.id, world.mall.id, { isAvailable: false });
    const api = await asPizzaManager();

    const mall = menuOf(await load(api, world.mall.id));
    const downtown = menuOf(await load(api, world.downtown.id));

    expect(mall.combos[0]?.slots[0]?.options.map((option) => option.itemId)).toEqual([
      world.items.margherita.id,
    ]);
    expect(downtown.combos[0]?.slots[0]?.options).toHaveLength(2);
  });

  it('leaves out a combo when one of its slots has no choice left at the branch', async () => {
    await makeCombo([[{ itemId: world.items.margherita.id }], [{ itemId: world.items.cola.id }]]);
    await setOverride(world.items.cola.id, world.mall.id, { isAvailable: false });
    const api = await asPizzaManager();

    expect(menuOf(await load(api, world.mall.id)).combos).toEqual([]);
    expect(menuOf(await load(api, world.downtown.id)).combos).toHaveLength(1);
  });

  it('leaves out a combo that is not active, and an item of a combo that is not active', async () => {
    await makeCombo([[{ itemId: world.items.margherita.id }]], false);
    await makeCombo([[{ itemId: world.items.cola.id }]]);
    await prisma.menuItem.update({ where: { id: world.items.cola.id }, data: { isActive: false } });
    const api = await asPizzaManager();

    expect(menuOf(await load(api, world.mall.id)).combos).toEqual([]);
  });

  it('has only the combos of the brand of the branch', async () => {
    await makeCombo([[{ itemId: world.items.margherita.id }]]);
    const api = await asBurgerManager();

    expect(menuOf(await load(api, world.airport.id)).combos).toEqual([]);
  });
});

describe('who may load the menu of a branch', () => {
  it('lets a cashier load the menu of their own branch, but not of another', async () => {
    const api = await asCashier();

    const own = await load(api, world.mall.id);
    const other = await load(api, world.downtown.id);

    expect(own.status).toBe(200);
    expect(other.status).toBe(404);
  });

  it('lets a branch manager load their own branch, and a brand manager any branch of their brand', async () => {
    expect((await load(await asMallManager(), world.mall.id)).status).toBe(200);
    expect((await load(await asMallManager(), world.downtown.id)).status).toBe(404);
    expect((await load(await asPizzaManager(), world.downtown.id)).status).toBe(200);
  });

  it('lets a group admin load any branch', async () => {
    const api = await asAdmin();

    expect(menuOf(await load(api, world.airport.id)).brandId).toBe(world.burger.id);
    expect(menuOf(await load(api, world.mall.id)).brandId).toBe(world.pizza.id);
  });

  it('answers that a branch was not found for one of another brand, as for one that does not exist', async () => {
    const api = await asPizzaManager();

    const other = await load(api, world.airport.id);
    const missing = await load(api, '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b');

    expect(other.status).toBe(404);
    expect(other.body).toEqual(missing.body);
  });

  it('does not give a menu that is in the cache to somebody who may not see the branch', async () => {
    const owner = await asPizzaManager();
    expect((await load(owner, world.mall.id)).status).toBe(200);
    expect((await load(owner, world.mall.id)).status).toBe(200);

    const stranger = await asBurgerManager();
    const res = await load(stranger, world.mall.id);

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Margherita');
  });

  it('needs a branch, and a signed-in person', async () => {
    const api = await asPizzaManager();

    expect((await api.get(MENU)).status).toBe(400);
    expect((await api.get(`${MENU}?branchId=nope`)).status).toBe(400);
    expect((await request(app).get(`${MENU}?branchId=${world.mall.id}`)).status).toBe(401);
    expect(errorOf(await api.get(MENU)).code).toBe('VALIDATION_ERROR');
  });
});

describe('the cache of the menu of a branch', () => {
  const stats = () => cache.stats();

  it('answers the second load from memory, with the same menu', async () => {
    const api = await asPizzaManager();
    const before = stats();

    const first = await load(api, world.mall.id);
    const second = await load(api, world.mall.id);

    expect(second.body).toEqual(first.body);
    expect(stats().misses - before.misses).toBe(1);
    expect(stats().hits - before.hits).toBe(1);
  });

  it('shows a change at once: a new price is in the next load', async () => {
    const api = await asPizzaManager();
    await load(api, world.mall.id);

    await api.patch(`${MENU}/items/${world.items.margherita.id}`, { basePrice: '21.5' });

    const menu = menuOf(await load(api, world.mall.id));
    expect(priceOf(menu, world.items.margherita.id)).toBe('21.500');
  });

  it('shows a change of the menu in every branch of the brand', async () => {
    const api = await asPizzaManager();
    await load(api, world.mall.id);
    await load(api, world.downtown.id);

    await api.patch(`${MENU}/items/${world.items.cola.id}`, { isActive: false });

    expect(itemNames(menuOf(await load(api, world.mall.id))).flat(2)).not.toContain('Cola');
    expect(itemNames(menuOf(await load(api, world.downtown.id))).flat(2)).not.toContain('Cola');
  });

  it('clears only the branch when only the price of that branch changes', async () => {
    const api = await asPizzaManager();
    await load(api, world.mall.id);
    await load(api, world.downtown.id);
    const before = stats();

    await api.put(`${MENU}/items/${world.items.margherita.id}/branch-override`, {
      branchId: world.mall.id,
      price: '25',
    });
    const downtown = await load(api, world.downtown.id);
    const mall = await load(api, world.mall.id);

    expect(stats().hits - before.hits).toBe(1);
    expect(stats().misses - before.misses).toBe(1);
    expect(priceOf(menuOf(mall), world.items.margherita.id)).toBe('25.000');
    expect(priceOf(menuOf(downtown), world.items.margherita.id)).toBe('20.000');
  });

  it('shows a category that was switched off, and a combo that was added, at once', async () => {
    const api = await asPizzaManager();
    await load(api, world.mall.id);

    await api.patch(`${MENU}/categories/${world.categories.drinks.id}`, { isActive: false });
    await api.post(`${MENU}/combos`, {
      name: { en: 'Meal', ar: 'وجبة' },
      price: '30',
      slots: [
        { name: { en: 'Pizza', ar: 'بيتزا' }, options: [{ itemId: world.items.margherita.id }] },
      ],
    });

    const menu = menuOf(await load(api, world.mall.id));
    expect(menu.categories.map((category) => category.name.en)).toEqual(['Pizzas']);
    expect(menu.combos).toHaveLength(1);
  });

  it('keeps the menus of the other brand when this brand changes', async () => {
    const burger = await asBurgerManager();
    await load(burger, world.airport.id);
    const before = stats();

    await (
      await asPizzaManager()
    ).patch(`${MENU}/items/${world.items.cola.id}`, { basePrice: '6' });
    await load(burger, world.airport.id);

    expect(stats().hits - before.hits).toBe(1);
  });

  it('forgets a menu when its time is up', async () => {
    const clock = { now: 1_000 };
    const shortCache = createMemoryMenuCache({ ttlMs: 60_000, now: () => clock.now });
    const shortApp = createApp({ prisma, config, menuCache: shortCache });
    const api = as(shortApp, await signIn(shortApp, 'pizza@x.io'));

    await load(api, world.mall.id);
    await load(api, world.mall.id);
    expect(shortCache.stats()).toMatchObject({ hits: 1, misses: 1 });

    clock.now += 60_001;
    await load(api, world.mall.id);

    expect(shortCache.stats()).toMatchObject({ hits: 1, misses: 2 });
  });

  it('gives the menu an ETag, and a short answer to a terminal that already has it', async () => {
    const token = await signIn(app, 'pizza@x.io');
    const first = await load(as(app, token), world.mall.id);
    const etag = String(first.headers.etag);
    expect(etag).toBeTruthy();

    const again = await request(app)
      .get(`${MENU}?branchId=${world.mall.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-None-Match', etag);

    expect(again.status).toBe(304);
    expect(again.text).toBe('');
  });

  it('has a different ETag when the menu has changed', async () => {
    const api = await asPizzaManager();
    const first = await load(api, world.mall.id);

    await api.patch(`${MENU}/items/${world.items.margherita.id}`, { basePrice: '21' });
    const second = await load(api, world.mall.id);

    expect(second.headers.etag).not.toBe(first.headers.etag);
  });
});

describe('a menu of 500 items', () => {
  it('is answered from the cache the second time, in well under a second', async () => {
    const category = await prisma.menuCategory.create({
      data: { brandId: world.pizza.id, name: { en: 'Everything', ar: 'كل شيء' }, sortOrder: 5 },
    });
    await prisma.menuItem.createMany({
      data: Array.from({ length: 500 }, (_, index) => {
        const name = { en: `Item ${String(index).padStart(3, '0')}`, ar: `صنف ${index}` };
        return {
          brandId: world.pizza.id,
          categoryId: category.id,
          name,
          searchText: searchTextOf(name),
          basePrice: `${index + 1}.500`,
        };
      }),
    });
    const api = await asPizzaManager();
    const before = cache.stats();

    const first = await load(api, world.mall.id);
    const started = performance.now();
    const second = await load(api, world.mall.id);
    const seconds = (performance.now() - started) / 1000;

    expect(first.status).toBe(200);
    const everything = menuOf(first).categories.find((entry) => entry.name.en === 'Everything');
    expect(everything?.items).toHaveLength(500);
    expect(second.body).toEqual(first.body);
    expect(cache.stats().hits - before.hits).toBe(1);
    expect(seconds).toBeLessThan(1);
  });
});
