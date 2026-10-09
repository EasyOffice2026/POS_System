import { type BranchMenu, branchMenuSchema, isOpenAtInstant } from '@pos/shared';
import type request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedDemoMenus } from '../prisma/demo-menu';
import { createApp } from '../src/app';
import { createPasswordHasher, hashProfiles } from '../src/lib/password';
import { syncSystemRoles } from '../src/lib/roles';
import { createBranch } from './factories';
import { createTestPrisma, resetDatabase, testConfig } from './helpers';
import { as, createUsersWorld, signIn, type UsersWorld } from './users-world';

// The demo menus of the seed (prisma/demo-menu.ts), loaded the way a terminal loads them.
const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const app = createApp({ prisma, config: testConfig() });

let world: UsersWorld;
let branchIds: Parameters<typeof seedDemoMenus>[2];

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  world = await createUsersWorld(prisma, hasher);
  const corniche = await createBranch(prisma, world.burger.id, 'Burger Corniche');
  branchIds = {
    pizzaMall: world.mall.id,
    pizzaDowntown: world.downtown.id,
    burgerAirport: world.airport.id,
    burgerCorniche: corniche.id,
  };
  await seedDemoMenus(prisma, { pizza: world.pizza.id, burger: world.burger.id }, branchIds);
});

const menuOf = (res: request.Response): BranchMenu => branchMenuSchema.parse(res.body);

async function loadMenu(branchId: string): Promise<BranchMenu> {
  const api = as(app, await signIn(app, 'admin@x.io'));
  const res = await api.get(`/api/v1/menu?branchId=${branchId}`);
  expect(res.status).toBe(200);
  return menuOf(res);
}

const itemsOf = (menu: BranchMenu) => menu.categories.flatMap((category) => category.items);
const itemNamed = (menu: BranchMenu, name: string) =>
  itemsOf(menu).find((item) => item.name.en === name);
const priceOf = (menu: BranchMenu, name: string) => itemNamed(menu, name)?.price;
const categoryNames = (menu: BranchMenu) => menu.categories.map((category) => category.name.en);

// A Wednesday and a Friday in Riyadh, where the clocks are three hours ahead of UTC all year.
const at = (day: 'wed' | 'thu' | 'fri', time: string) =>
  new Date(`2026-10-${{ wed: '07', thu: '08', fri: '09' }[day]}T${time}:00+03:00`);

describe('the demo menus', () => {
  it('give every demo branch a menu with dishes, in both languages, and combos', async () => {
    for (const branchId of Object.values(branchIds)) {
      const menu = await loadMenu(branchId);

      expect(menu.categories.length).toBeGreaterThan(0);
      for (const category of menu.categories) {
        expect(category.items.length).toBeGreaterThan(0);
        expect(category.name.ar).not.toBe('');
        for (const item of category.items) expect(item.name.ar).not.toBe('');
      }
      expect(menu.combos.length).toBeGreaterThan(0);
    }
  });

  it('keep each brand to its own dishes', async () => {
    const pizza = await loadMenu(branchIds.pizzaMall);
    const burger = await loadMenu(branchIds.burgerAirport);

    expect(itemNamed(pizza, 'Pepperoni')).toBeDefined();
    expect(itemNamed(pizza, 'Cheeseburger')).toBeUndefined();
    expect(itemNamed(burger, 'Cheeseburger')).toBeDefined();
    expect(itemNamed(burger, 'Pepperoni')).toBeUndefined();
    expect(pizza.combos).toHaveLength(2);
    expect(burger.combos).toHaveLength(1);
  });

  it('let a branch set its own price', async () => {
    const mall = await loadMenu(branchIds.pizzaMall);
    const downtown = await loadMenu(branchIds.pizzaDowntown);
    const airport = await loadMenu(branchIds.burgerAirport);
    const corniche = await loadMenu(branchIds.burgerCorniche);

    expect([priceOf(mall, 'Margherita'), priceOf(downtown, 'Margherita')]).toEqual([
      '27.000',
      '25.000',
    ]);
    expect([priceOf(mall, 'Pepperoni'), priceOf(downtown, 'Pepperoni')]).toEqual([
      '29.000',
      '30.000',
    ]);
    expect([priceOf(airport, 'Cheeseburger'), priceOf(corniche, 'Cheeseburger')]).toEqual([
      '21.000',
      '18.000',
    ]);
    expect(priceOf(airport, 'Fries')).toBe('10.000');
    expect(priceOf(corniche, 'Fries')).toBe('8.000');
  });

  it('let a branch switch a dish off, and leave out the category it empties', async () => {
    const mall = await loadMenu(branchIds.pizzaMall);
    const downtown = await loadMenu(branchIds.pizzaDowntown);

    expect(categoryNames(mall)).toEqual(['Pizzas', 'Sides', 'Drinks', 'Desserts']);
    expect(itemNamed(mall, 'Tiramisu')).toBeDefined();
    expect(categoryNames(downtown)).toEqual(['Pizzas', 'Sides', 'Drinks']);
    expect(itemNamed(downtown, 'Tiramisu')).toBeUndefined();
  });

  it('ask for a size on a pizza, and let the guest add up to three extras', async () => {
    const margherita = itemNamed(await loadMenu(branchIds.pizzaMall), 'Margherita');

    expect(margherita?.modifierGroups.map((group) => group.name.en)).toEqual([
      'Size',
      'Extra toppings',
    ]);
    const [size, toppings] = margherita?.modifierGroups ?? [];
    expect(size).toMatchObject({ minSelect: 1, maxSelect: 1 });
    expect(size?.modifiers.map((modifier) => modifier.priceDelta)).toEqual([
      '-5.000',
      '0.000',
      '6.000',
    ]);
    expect(toppings).toMatchObject({ minSelect: 0, maxSelect: 3 });
  });

  it('send a lunch-only dish with its schedule, read on the clock of the branch', async () => {
    const caesar = itemNamed(await loadMenu(branchIds.pizzaMall), 'Caesar Salad');
    const downtownCaesar = itemNamed(await loadMenu(branchIds.pizzaDowntown), 'Caesar Salad');

    expect(downtownCaesar?.schedule).toBeNull();
    const schedule = caesar?.schedule;
    if (!schedule) throw new Error('The salad at the mall should have a schedule.');
    const open = (day: 'wed' | 'thu' | 'fri', time: string) =>
      isOpenAtInstant(schedule, at(day, time), 'Asia/Riyadh');

    expect(open('wed', '12:00')).toBe(true);
    expect(open('wed', '18:00')).toBe(false);
    expect(open('fri', '12:00')).toBe(false);
  });

  it('send a late-night dish with a schedule that runs past midnight', async () => {
    const shake = itemNamed(await loadMenu(branchIds.burgerCorniche), 'Milkshake');
    const airportShake = itemNamed(await loadMenu(branchIds.burgerAirport), 'Milkshake');

    expect(airportShake?.schedule).toBeNull();
    const schedule = shake?.schedule;
    if (!schedule) throw new Error('The milkshake at the corniche should have a schedule.');
    const open = (day: 'wed' | 'thu' | 'fri', time: string) =>
      isOpenAtInstant(schedule, at(day, time), 'Asia/Riyadh');

    expect(open('wed', '08:00')).toBe(false);
    expect(open('wed', '23:00')).toBe(true);
    expect(open('thu', '01:00')).toBe(true);
    expect(open('thu', '03:00')).toBe(false);
  });

  it('build every combo from dishes the branch sells', async () => {
    for (const branchId of Object.values(branchIds)) {
      const menu = await loadMenu(branchId);
      const sold = new Set(itemsOf(menu).map((item) => item.id));

      for (const combo of menu.combos) {
        expect(combo.slots.length).toBeGreaterThan(0);
        for (const slot of combo.slots) {
          expect(slot.options.length).toBeGreaterThan(0);
          for (const option of slot.options) expect(sold.has(option.itemId)).toBe(true);
        }
      }
    }
  });

  it('can be written again without making copies', async () => {
    const counts = async () => ({
      categories: await prisma.menuCategory.count(),
      items: await prisma.menuItem.count(),
      groups: await prisma.modifierGroup.count(),
      modifiers: await prisma.modifier.count(),
      combos: await prisma.combo.count(),
      slots: await prisma.comboSlot.count(),
      options: await prisma.comboSlotOption.count(),
      overrides: await prisma.branchMenuItem.count(),
    });
    const before = await counts();

    await seedDemoMenus(prisma, { pizza: world.pizza.id, burger: world.burger.id }, branchIds);

    expect(await counts()).toEqual(before);
    expect(before.items).toBeGreaterThan(0);
  });
});
