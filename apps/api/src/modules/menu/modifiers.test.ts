import {
  MAX_MODIFIERS_PER_GROUP,
  menuItemDetailSchema,
  modifierGroupSchema,
  modifierSchema,
} from '@pos/shared';
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

const MENU = '/api/v1/menu';
const groupsOf = (itemId: string) => `${MENU}/items/${itemId}/modifier-groups`;
const group = (id: string) => `${MENU}/modifier-groups/${id}`;
const modifiersOf = (groupId: string) => `${MENU}/modifier-groups/${groupId}/modifiers`;
const modifier = (id: string) => `${MENU}/modifiers/${id}`;

const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));
const asMallManager = async () => as(app, await signIn(app, 'mall-manager@x.io'));
const asCashier = async () => as(app, await signIn(app, 'cashier@x.io'));
const auditRows = (action: string) => prisma.auditLog.findMany({ where: { action } });

function messagesOf(res: request.Response): string[] {
  return (errorOf(res).details ?? []).map((detail) => `${detail.path}:${detail.message}`);
}

async function cacheMenu(brandId: string, branchId: string) {
  await cache.set(brandId, branchId, '{"cached":true}', await cache.begin(brandId));
}

const size = {
  name: { en: 'Size', ar: 'الحجم' },
  minSelect: 1,
  maxSelect: 1,
  modifiers: [
    { name: { en: 'Small', ar: 'صغير' }, priceDelta: '-3' },
    { name: { en: 'Medium', ar: 'وسط' } },
    { name: { en: 'Large', ar: 'كبير' }, priceDelta: '4' },
  ],
};

// A group with a modifier, made directly, for the tests that change them.
async function makeGroup(itemId = world.items.margherita.id) {
  const created = await prisma.modifierGroup.create({
    data: {
      brandId: world.pizza.id,
      itemId,
      name: { en: 'Extras', ar: 'إضافات' },
      minSelect: 0,
      maxSelect: 3,
    },
  });
  const extra = await prisma.modifier.create({
    data: {
      brandId: world.pizza.id,
      groupId: created.id,
      name: { en: 'Cheese', ar: 'جبنة' },
      priceDelta: '2.000',
    },
  });
  return { group: created, modifier: extra };
}

describe('POST /menu/items/:id/modifier-groups', () => {
  it('adds a group with its modifiers to an item, the price changes as text', async () => {
    const api = await asPizzaManager();

    const res = await api.post(groupsOf(world.items.margherita.id), size);

    expect(res.status).toBe(201);
    const created = modifierGroupSchema.parse(res.body);
    expect(created).toMatchObject({
      itemId: world.items.margherita.id,
      name: size.name,
      minSelect: 1,
      maxSelect: 1,
      isActive: true,
    });
    expect(created.modifiers.map((entry) => [entry.name.en, entry.priceDelta])).toEqual([
      ['Small', '-3.000'],
      ['Medium', '0.000'],
      ['Large', '4.000'],
    ]);
  });

  it('shows the group on the item, in the order it was added', async () => {
    const api = await asPizzaManager();
    await api.post(groupsOf(world.items.margherita.id), size);
    await api.post(groupsOf(world.items.margherita.id), {
      name: { en: 'Extras', ar: 'إضافات' },
      maxSelect: 3,
    });

    const res = await api.get(`${MENU}/items/${world.items.margherita.id}`);

    const item = menuItemDetailSchema.parse(res.body);
    expect(item.modifierGroups.map((entry) => entry.name.en)).toEqual(['Size', 'Extras']);
    expect(item.modifierGroups[0]?.modifiers).toHaveLength(3);
    expect(item.modifierGroups[1]?.modifiers).toEqual([]);
  });

  it('starts as an optional choice of one, with no modifiers', async () => {
    const api = await asPizzaManager();

    const res = await api.post(groupsOf(world.items.margherita.id), { name: size.name });

    expect(modifierGroupSchema.parse(res.body)).toMatchObject({
      minSelect: 0,
      maxSelect: 1,
      modifiers: [],
    });
  });

  it('writes the creation to the audit log', async () => {
    const api = await asPizzaManager();

    const res = await api.post(groupsOf(world.items.margherita.id), size);

    const [row] = await auditRows('menu.modifier_group.created');
    expect(row).toMatchObject({
      userId: world.users.pizzaManager.id,
      brandId: world.pizza.id,
      entityType: 'modifier_group',
      entityId: modifierGroupSchema.parse(res.body).id,
    });
    expect(row?.metadata).toEqual({
      itemId: world.items.margherita.id,
      name: size.name,
      minSelect: 1,
      maxSelect: 1,
      modifiers: 3,
    });
  });

  it('refuses a smallest choice that is larger than the largest, and creates nothing', async () => {
    const api = await asPizzaManager();

    const res = await api.post(groupsOf(world.items.margherita.id), {
      ...size,
      minSelect: 3,
      maxSelect: 2,
    });

    expect(messagesOf(res)).toEqual(['maxSelect:SELECT_RANGE_INVALID']);
    expect(await prisma.modifierGroup.count()).toBe(0);
    expect(await prisma.modifier.count()).toBe(0);
  });

  it('refuses limits outside what is allowed, and names which one', async () => {
    const api = await asPizzaManager();

    expect(
      messagesOf(await api.post(groupsOf(world.items.margherita.id), { ...size, minSelect: -1 })),
    ).toEqual(['minSelect:MIN_SELECT_INVALID']);
    expect(
      messagesOf(await api.post(groupsOf(world.items.margherita.id), { ...size, maxSelect: 0 })),
    ).toEqual(['maxSelect:MAX_SELECT_INVALID']);
  });

  it('needs both names for the group and for each modifier', async () => {
    const api = await asPizzaManager();

    const group = await api.post(groupsOf(world.items.margherita.id), { name: { en: 'Size' } });
    const inline = await api.post(groupsOf(world.items.margherita.id), {
      name: size.name,
      modifiers: [{ name: { en: 'Small' } }],
    });

    expect(messagesOf(group)).toEqual(['name.ar:NAME_REQUIRED']);
    expect(messagesOf(inline)).toEqual(['modifiers.0.name.ar:NAME_REQUIRED']);
  });

  it('answers that an item was not found for one of another brand', async () => {
    const api = await asPizzaManager();

    const res = await api.post(groupsOf(world.items.cheeseburger.id), size);

    expect(res.status).toBe(404);
    expect(await prisma.modifierGroup.count()).toBe(0);
  });

  it('is not allowed for a branch manager or a cashier', async () => {
    for (const api of [await asMallManager(), await asCashier()]) {
      const res = await api.post(groupsOf(world.items.margherita.id), size);

      expect(res.status).toBe(403);
    }
  });

  it('clears the menus of the brand from the cache', async () => {
    await cacheMenu(world.pizza.id, world.mall.id);
    const api = await asPizzaManager();

    await api.post(groupsOf(world.items.margherita.id), size);

    expect(await cache.get(world.pizza.id, world.mall.id)).toBeNull();
  });
});

describe('PATCH /menu/modifier-groups/:id', () => {
  it('renames a group and changes how many choices it takes', async () => {
    const { group: extras } = await makeGroup();
    const api = await asPizzaManager();

    const res = await api.patch(group(extras.id), {
      name: { en: 'Toppings', ar: 'إضافات الوجه' },
      minSelect: 1,
      maxSelect: 2,
    });

    expect(res.status).toBe(200);
    expect(modifierGroupSchema.parse(res.body)).toMatchObject({
      name: { en: 'Toppings' },
      minSelect: 1,
      maxSelect: 2,
    });
    const [row] = await auditRows('menu.modifier_group.updated');
    expect(row?.metadata).toMatchObject({ changed: ['name', 'minSelect', 'maxSelect'] });
  });

  it('checks a limit against the one that is stored', async () => {
    const { group: extras } = await makeGroup();
    const api = await asPizzaManager();

    const tooHigh = await api.patch(group(extras.id), { minSelect: 4 });
    const tooLow = await api.patch(group(extras.id), { maxSelect: 1, minSelect: 2 });

    expect(messagesOf(tooHigh)).toEqual(['maxSelect:SELECT_RANGE_INVALID']);
    expect(messagesOf(tooLow)).toEqual(['maxSelect:SELECT_RANGE_INVALID']);
    expect(
      (await prisma.modifierGroup.findUniqueOrThrow({ where: { id: extras.id } })).minSelect,
    ).toBe(0);
  });

  it('makes a group required by giving it a smallest choice of 1', async () => {
    const { group: extras } = await makeGroup();
    const api = await asPizzaManager();

    const res = await api.patch(group(extras.id), { minSelect: 1 });

    expect(modifierGroupSchema.parse(res.body).minSelect).toBe(1);
  });

  it('deactivates a group and keeps it, with its modifiers', async () => {
    const { group: extras } = await makeGroup();
    const api = await asPizzaManager();

    const res = await api.patch(group(extras.id), { isActive: false });

    expect(modifierGroupSchema.parse(res.body)).toMatchObject({ isActive: false });
    expect(modifierGroupSchema.parse(res.body).modifiers).toHaveLength(1);
    const [row] = await auditRows('menu.modifier_group.updated');
    expect(row?.metadata).toMatchObject({ changed: ['isActive'], isActive: false });
  });

  it('says nothing and writes nothing when nothing changes', async () => {
    const { group: extras } = await makeGroup();
    const api = await asPizzaManager();

    const res = await api.patch(group(extras.id), { minSelect: 0, maxSelect: 3, isActive: true });

    expect(res.status).toBe(200);
    expect(await auditRows('menu.modifier_group.updated')).toHaveLength(0);
  });

  it('refuses a request that changes nothing', async () => {
    const { group: extras } = await makeGroup();
    const api = await asPizzaManager();

    expect(messagesOf(await api.patch(group(extras.id), {}))).toEqual([':NOTHING_TO_UPDATE']);
  });

  it('answers that a group was not found for one of another brand', async () => {
    const other = await prisma.modifierGroup.create({
      data: {
        brandId: world.burger.id,
        itemId: world.items.cheeseburger.id,
        name: { en: 'Sauce', ar: 'صلصة' },
      },
    });
    const api = await asPizzaManager();

    const res = await api.patch(group(other.id), { isActive: false });

    expect(res.status).toBe(404);
  });

  it('is not allowed for a branch manager or a cashier', async () => {
    const { group: extras } = await makeGroup();

    for (const api of [await asMallManager(), await asCashier()]) {
      expect((await api.patch(group(extras.id), { isActive: false })).status).toBe(403);
    }
  });
});

describe('POST /menu/modifier-groups/:id/modifiers', () => {
  const name = { en: 'Olives', ar: 'زيتون' };

  it('adds a modifier at the end of the group', async () => {
    const { group: extras } = await makeGroup();
    const api = await asPizzaManager();

    const res = await api.post(modifiersOf(extras.id), { name, priceDelta: '1.5' });

    expect(res.status).toBe(201);
    expect(modifierSchema.parse(res.body)).toMatchObject({
      groupId: extras.id,
      name,
      priceDelta: '1.500',
      isActive: true,
    });
    const detail = menuItemDetailSchema.parse(
      (await api.get(`${MENU}/items/${world.items.margherita.id}`)).body,
    );
    expect(detail.modifierGroups[0]?.modifiers.map((entry) => entry.name.en)).toEqual([
      'Cheese',
      'Olives',
    ]);
  });

  it('has no price change unless one is given, and a price change can be below zero', async () => {
    const { group: extras } = await makeGroup();
    const api = await asPizzaManager();

    const free = await api.post(modifiersOf(extras.id), { name });
    const cheaper = await api.post(modifiersOf(extras.id), {
      name: { en: 'No cheese', ar: 'بدون جبنة' },
      priceDelta: '-2',
    });

    expect(modifierSchema.parse(free.body).priceDelta).toBe('0.000');
    expect(modifierSchema.parse(cheaper.body).priceDelta).toBe('-2.000');
  });

  it('writes it to the audit log', async () => {
    const { group: extras } = await makeGroup();
    const api = await asPizzaManager();

    const res = await api.post(modifiersOf(extras.id), { name, priceDelta: '1.5' });

    const [row] = await auditRows('menu.modifier.created');
    expect(row).toMatchObject({
      brandId: world.pizza.id,
      entityType: 'modifier',
      entityId: modifierSchema.parse(res.body).id,
    });
    expect(row?.metadata).toEqual({
      groupId: extras.id,
      itemId: world.items.margherita.id,
      name,
      priceDelta: '1.500',
    });
  });

  it('refuses a name in one language and a price that is not a price', async () => {
    const { group: extras } = await makeGroup();
    const api = await asPizzaManager();

    expect(messagesOf(await api.post(modifiersOf(extras.id), { name: { en: 'Olives' } }))).toEqual([
      'name.ar:NAME_REQUIRED',
    ]);
    expect(
      messagesOf(await api.post(modifiersOf(extras.id), { name, priceDelta: 'free' })),
    ).toEqual(['priceDelta:PRICE_INVALID']);
  });

  it('stops at the most modifiers a group can have', async () => {
    const { group: extras } = await makeGroup();
    const have = await prisma.modifier.count({ where: { groupId: extras.id } });
    await prisma.modifier.createMany({
      data: Array.from({ length: MAX_MODIFIERS_PER_GROUP - have }, (_, index) => ({
        brandId: world.pizza.id,
        groupId: extras.id,
        name: { en: `Extra ${index}`, ar: `إضافي ${index}` },
        sortOrder: 10 + index,
      })),
    });
    const api = await asPizzaManager();

    const res = await api.post(modifiersOf(extras.id), { name });

    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('MODIFIER_LIMIT');
  });

  it('answers that a group was not found for one of another brand', async () => {
    const other = await prisma.modifierGroup.create({
      data: {
        brandId: world.burger.id,
        itemId: world.items.cheeseburger.id,
        name: { en: 'Sauce', ar: 'صلصة' },
      },
    });
    const api = await asPizzaManager();

    expect((await api.post(modifiersOf(other.id), { name })).status).toBe(404);
  });

  it('is not allowed for a branch manager or a cashier', async () => {
    const { group: extras } = await makeGroup();

    for (const api of [await asMallManager(), await asCashier()]) {
      expect((await api.post(modifiersOf(extras.id), { name })).status).toBe(403);
    }
  });

  it('clears the menus of the brand from the cache', async () => {
    const { group: extras } = await makeGroup();
    await cacheMenu(world.pizza.id, world.mall.id);
    const api = await asPizzaManager();

    await api.post(modifiersOf(extras.id), { name });

    expect(await cache.get(world.pizza.id, world.mall.id)).toBeNull();
  });
});

describe('PATCH /menu/modifiers/:id', () => {
  it('changes the price change, and the audit log says from what to what', async () => {
    const { modifier: cheese } = await makeGroup();
    const api = await asPizzaManager();

    const res = await api.patch(modifier(cheese.id), { priceDelta: '2.5' });

    expect(modifierSchema.parse(res.body).priceDelta).toBe('2.500');
    const [row] = await auditRows('menu.modifier.updated');
    expect(row?.metadata).toMatchObject({
      changed: ['priceDelta'],
      priceDelta: { from: '2.000', to: '2.500' },
    });
  });

  it('renames a modifier, and deactivates it without deleting it', async () => {
    const { modifier: cheese } = await makeGroup();
    const api = await asPizzaManager();

    const renamed = await api.patch(modifier(cheese.id), {
      name: { en: 'Mozzarella', ar: 'موزاريلا' },
    });
    const off = await api.patch(modifier(cheese.id), { isActive: false });

    expect(modifierSchema.parse(renamed.body).name.en).toBe('Mozzarella');
    expect(modifierSchema.parse(off.body).isActive).toBe(false);
    expect(await prisma.modifier.count()).toBe(1);
  });

  it('says nothing and writes nothing when nothing changes', async () => {
    const { modifier: cheese } = await makeGroup();
    const api = await asPizzaManager();

    const res = await api.patch(modifier(cheese.id), { priceDelta: '2', isActive: true });

    expect(res.status).toBe(200);
    expect(await auditRows('menu.modifier.updated')).toHaveLength(0);
  });

  it('refuses a request that changes nothing', async () => {
    const { modifier: cheese } = await makeGroup();
    const api = await asPizzaManager();

    expect(messagesOf(await api.patch(modifier(cheese.id), {}))).toEqual([':NOTHING_TO_UPDATE']);
  });

  it('answers that a modifier was not found for one of another brand', async () => {
    const otherGroup = await prisma.modifierGroup.create({
      data: {
        brandId: world.burger.id,
        itemId: world.items.cheeseburger.id,
        name: { en: 'Sauce', ar: 'صلصة' },
      },
    });
    const other = await prisma.modifier.create({
      data: {
        brandId: world.burger.id,
        groupId: otherGroup.id,
        name: { en: 'BBQ', ar: 'باربكيو' },
      },
    });
    const api = await asPizzaManager();

    expect((await api.patch(modifier(other.id), { isActive: false })).status).toBe(404);
  });

  it('is not allowed for a branch manager or a cashier', async () => {
    const { modifier: cheese } = await makeGroup();

    for (const api of [await asMallManager(), await asCashier()]) {
      expect((await api.patch(modifier(cheese.id), { isActive: false })).status).toBe(403);
    }
  });

  it('clears the menus of the brand from the cache', async () => {
    const { modifier: cheese } = await makeGroup();
    await cacheMenu(world.pizza.id, world.mall.id);
    const api = await asPizzaManager();

    await api.patch(modifier(cheese.id), { priceDelta: '3' });

    expect(await cache.get(world.pizza.id, world.mall.id)).toBeNull();
  });
});
