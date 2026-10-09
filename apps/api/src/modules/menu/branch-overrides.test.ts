import { branchOverrideSchema, closedWeek, type OpeningHours } from '@pos/shared';
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
const override = (itemId: string) => `${ITEMS}/${itemId}/branch-override`;
const overrides = (itemId: string) => `${ITEMS}/${itemId}/branch-overrides`;

const asAdmin = async () => as(app, await signIn(app, 'admin@x.io'));
const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));
const asMallManager = async () => as(app, await signIn(app, 'mall-manager@x.io'));
const asCashier = async () => as(app, await signIn(app, 'cashier@x.io'));
const auditRows = () =>
  prisma.auditLog.findMany({ where: { action: 'menu.item.branch_override_set' } });

function messagesOf(res: request.Response): string[] {
  return (errorOf(res).details ?? []).map((detail) => `${detail.path}:${detail.message}`);
}

const listOf = (res: request.Response) =>
  (res.body as { data: unknown[] }).data.map((row) => branchOverrideSchema.parse(row));

const week = (days: Partial<OpeningHours>): OpeningHours => ({ ...closedWeek(), ...days });
const lunch: OpeningHours = week({
  monday: { kind: 'ranges', ranges: [{ open: '11:00', close: '15:00' }] },
  tuesday: { kind: 'ranges', ranges: [{ open: '11:00', close: '15:00' }] },
});

async function cacheMenu(brandId: string, branchId: string) {
  await cache.set(brandId, branchId, '{"cached":true}', await cache.begin(brandId));
}

describe('PUT /menu/items/:id/branch-override', () => {
  const margherita = () => world.items.margherita.id;

  it('sets the price of an item for one branch', async () => {
    const api = await asPizzaManager();

    const res = await api.put(override(margherita()), { branchId: world.mall.id, price: '22.5' });

    expect(res.status).toBe(200);
    expect(branchOverrideSchema.parse(res.body)).toEqual({
      itemId: margherita(),
      branchId: world.mall.id,
      price: '22.500',
      isAvailable: true,
      schedule: null,
    });
    const stored = await prisma.branchMenuItem.findUniqueOrThrow({
      where: { branchId_itemId: { branchId: world.mall.id, itemId: margherita() } },
    });
    expect(stored.priceOverride?.toFixed(3)).toBe('22.500');
    expect(stored.brandId).toBe(world.pizza.id);
  });

  it('writes it to the audit log, with the brand and the branch', async () => {
    const api = await asPizzaManager();

    await api.put(override(margherita()), { branchId: world.mall.id, price: '22.5' });

    const [row] = await auditRows();
    expect(row).toMatchObject({
      userId: world.users.pizzaManager.id,
      brandId: world.pizza.id,
      branchId: world.mall.id,
      entityType: 'menu_item',
      entityId: margherita(),
    });
    expect(row?.metadata).toEqual({ price: '22.500', isAvailable: true, scheduled: false });
  });

  it('switches an item off for one branch', async () => {
    const api = await asPizzaManager();

    const res = await api.put(override(margherita()), {
      branchId: world.downtown.id,
      isAvailable: false,
    });

    expect(branchOverrideSchema.parse(res.body)).toMatchObject({
      branchId: world.downtown.id,
      price: null,
      isAvailable: false,
    });
  });

  it('limits an item to the days and times of a schedule, kept in the order of the clock', async () => {
    const api = await asPizzaManager();

    const res = await api.put(override(margherita()), {
      branchId: world.mall.id,
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

    expect(res.status).toBe(200);
    expect(branchOverrideSchema.parse(res.body).schedule?.monday).toEqual({
      kind: 'ranges',
      ranges: [
        { open: '11:00', close: '15:00' },
        { open: '18:00', close: '23:00' },
      ],
    });
    const [row] = await auditRows();
    expect(row?.metadata).toMatchObject({ scheduled: true });
  });

  it('checks the schedule with the rules of opening hours, and names the day', async () => {
    const api = await asPizzaManager();

    const res = await api.put(override(margherita()), {
      branchId: world.mall.id,
      schedule: week({
        tuesday: {
          kind: 'ranges',
          ranges: [
            { open: '09:00', close: '14:00' },
            { open: '13:00', close: '18:00' },
          ],
        },
      }),
    });

    expect(res.status).toBe(400);
    expect(messagesOf(res)).toEqual(['schedule.tuesday:HOURS_OVERLAP']);
    expect(await prisma.branchMenuItem.count()).toBe(0);
  });

  it('lists only the branches that differ, and not the ones that do not', async () => {
    const api = await asPizzaManager();
    expect(listOf(await api.get(overrides(margherita())))).toEqual([]);

    await api.put(override(margherita()), { branchId: world.mall.id, price: '22.5' });
    await api.put(override(margherita()), { branchId: world.downtown.id, isAvailable: false });

    const rows = listOf(await api.get(overrides(margherita())));
    expect(rows.map((row) => row.branchId).sort()).toEqual(
      [world.mall.id, world.downtown.id].sort(),
    );
  });

  it('changes an override that is there', async () => {
    const api = await asPizzaManager();
    await api.put(override(margherita()), { branchId: world.mall.id, price: '22.5' });

    const res = await api.put(override(margherita()), {
      branchId: world.mall.id,
      price: '23',
      isAvailable: false,
    });

    expect(branchOverrideSchema.parse(res.body)).toMatchObject({
      price: '23.000',
      isAvailable: false,
    });
    expect(await prisma.branchMenuItem.count()).toBe(1);
    expect(await auditRows()).toHaveLength(2);
  });

  it('removes the override when everything is put back, because a branch only stores differences', async () => {
    const api = await asPizzaManager();
    await api.put(override(margherita()), { branchId: world.mall.id, price: '22.5' });

    const res = await api.put(override(margherita()), { branchId: world.mall.id });

    expect(branchOverrideSchema.parse(res.body)).toEqual({
      itemId: margherita(),
      branchId: world.mall.id,
      price: null,
      isAvailable: true,
      schedule: null,
    });
    expect(await prisma.branchMenuItem.count()).toBe(0);
    expect(listOf(await api.get(overrides(margherita())))).toEqual([]);
    expect(await auditRows()).toHaveLength(2);
  });

  it('writes nothing for a branch that has no changes and is asked to have none', async () => {
    const api = await asPizzaManager();

    const res = await api.put(override(margherita()), { branchId: world.mall.id });

    expect(res.status).toBe(200);
    expect(await prisma.branchMenuItem.count()).toBe(0);
    expect(await auditRows()).toHaveLength(0);
  });

  it('says nothing and writes nothing when the override is already as asked', async () => {
    const api = await asPizzaManager();
    await api.put(override(margherita()), {
      branchId: world.mall.id,
      price: '22.5',
      schedule: lunch,
    });
    await cacheMenu(world.pizza.id, world.mall.id);

    const res = await api.put(override(margherita()), {
      branchId: world.mall.id,
      price: '22.500',
      schedule: lunch,
    });

    expect(res.status).toBe(200);
    expect(await auditRows()).toHaveLength(1);
    expect(await cache.get(world.pizza.id, world.mall.id)).not.toBeNull();
  });

  it('refuses a branch of another brand, and one that does not exist', async () => {
    const api = await asPizzaManager();

    const other = await api.put(override(margherita()), { branchId: world.airport.id, price: '1' });
    const missing = await api.put(override(margherita()), {
      branchId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      price: '1',
    });

    expect(messagesOf(other)).toEqual(['branchId:BRANCH_NOT_FOUND']);
    expect(messagesOf(missing)).toEqual(['branchId:BRANCH_NOT_FOUND']);
    expect(await prisma.branchMenuItem.count()).toBe(0);
  });

  it('answers that an item was not found for one of another brand', async () => {
    const api = await asPizzaManager();

    const res = await api.put(override(world.items.cheeseburger.id), {
      branchId: world.airport.id,
      price: '1',
    });

    expect(res.status).toBe(404);
    expect(await prisma.branchMenuItem.count()).toBe(0);
  });

  it('refuses a price that is not a price, fields it does not know, and no branch', async () => {
    const api = await asPizzaManager();

    expect(
      messagesOf(await api.put(override(margherita()), { branchId: world.mall.id, price: '-1' })),
    ).toEqual(['price:PRICE_INVALID']);
    expect(
      (await api.put(override(margherita()), { branchId: world.mall.id, itemId: margherita() }))
        .status,
    ).toBe(400);
    expect((await api.put(override(margherita()), { price: '1' })).status).toBe(400);
  });

  it('lets a group admin set it for any brand', async () => {
    const api = await asAdmin();

    const res = await api.put(override(world.items.cheeseburger.id), {
      branchId: world.airport.id,
      price: '19',
    });

    expect(res.status).toBe(200);
    expect(branchOverrideSchema.parse(res.body).price).toBe('19.000');
  });

  it('is not allowed for a branch manager or a cashier', async () => {
    for (const api of [await asMallManager(), await asCashier()]) {
      const res = await api.put(override(margherita()), { branchId: world.mall.id, price: '1' });

      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe('FORBIDDEN');
    }
    expect(await prisma.branchMenuItem.count()).toBe(0);
  });

  it('clears only the menu of that branch from the cache', async () => {
    await cacheMenu(world.pizza.id, world.mall.id);
    await cacheMenu(world.pizza.id, world.downtown.id);
    await cacheMenu(world.burger.id, world.airport.id);
    const api = await asPizzaManager();

    await api.put(override(margherita()), { branchId: world.mall.id, price: '22.5' });

    expect(await cache.get(world.pizza.id, world.mall.id)).toBeNull();
    expect(await cache.get(world.pizza.id, world.downtown.id)).not.toBeNull();
    expect(await cache.get(world.burger.id, world.airport.id)).not.toBeNull();
  });
});

describe('GET /menu/items/:id/branch-overrides', () => {
  beforeEach(async () => {
    const itemId = world.items.margherita.id;
    for (const branch of [world.mall, world.downtown]) {
      await prisma.branchMenuItem.create({
        data: { branchId: branch.id, itemId, brandId: world.pizza.id, priceOverride: '22.500' },
      });
    }
  });

  it('shows a brand manager the overrides of every branch of their brand', async () => {
    const api = await asPizzaManager();

    const rows = listOf(await api.get(overrides(world.items.margherita.id)));

    expect(rows).toHaveLength(2);
  });

  it('shows a branch manager only the override of their own branch', async () => {
    const api = await asMallManager();

    const rows = listOf(await api.get(overrides(world.items.margherita.id)));

    expect(rows.map((row) => row.branchId)).toEqual([world.mall.id]);
  });

  it('answers that an item was not found for one of another brand', async () => {
    const api = await asPizzaManager();

    expect((await api.get(overrides(world.items.cheeseburger.id))).status).toBe(404);
  });
});
