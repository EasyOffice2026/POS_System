import {
  pageSchema,
  type StockCount,
  stockCountSchema,
  stockCountSummarySchema,
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
const clock = new Date('2026-10-14T21:00:00Z');
const app = createApp({
  prisma,
  config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }),
  now: () => clock,
});

let world: UsersWorld;
let flour: { id: string };
let mozzarella: { id: string };

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
  const ingredient = (en: string, cost: string, isActive = true) =>
    prisma.ingredient.create({
      data: {
        brandId: world.pizza.id,
        name: { en, ar: `${en} (ar)` },
        searchText: en.toLowerCase(),
        unit: 'kg',
        costPerUnit: cost,
        isActive,
      },
    });
  flour = await ingredient('Flour', '0.400');
  mozzarella = await ingredient('Mozzarella', '3.000');
  await ingredient('Old sauce', '1.000', false);
  for (const [ingredientId, quantity] of [
    [flour.id, '10'],
    [mozzarella.id, '4'],
  ] as const) {
    await prisma.branchStock.create({
      data: { brandId: world.pizza.id, branchId: world.mall.id, ingredientId, quantity },
    });
  }
});

type Api = ReturnType<typeof as>;
const COUNTS = '/api/v1/inventory/counts';
const asMallManager = async () => as(app, await signIn(app, 'mall-manager@x.io'));
const asPurchaser = async () => as(app, await signIn(app, 'purchaser@x.io'));
const asCashier = async () => as(app, await signIn(app, 'cashier@x.io'));
const asBurgerManager = async () => as(app, await signIn(app, 'burger@x.io'));

const countOf = (res: request.Response): StockCount => stockCountSchema.parse(res.body);
const messagesOf = (res: request.Response) =>
  (errorOf(res).details ?? []).map((detail) => `${detail.path}:${detail.message}`);
const lineOf = (count: StockCount, ingredientId: string) =>
  count.lines.find((line) => line.ingredient.id === ingredientId);

const stockAt = async (ingredientId: string) =>
  (
    await prisma.branchStock.findUnique({
      where: { branchId_ingredientId: { branchId: world.mall.id, ingredientId } },
    })
  )?.quantity.toFixed(3);

async function startAtMall(api: Api, extra: object = {}) {
  const res = await api.post(COUNTS, { branchId: world.mall.id, ...extra });
  expect(res.status).toBe(201);
  return countOf(res);
}

const save = (
  api: Api,
  countId: string,
  lines: { ingredientId: string; counted: string | null }[],
) => api.put(`${COUNTS}/${countId}/lines`, { lines });

describe('starting a count', () => {
  it('lists every active ingredient with the stock the system has (criterion 1)', async () => {
    const count = await startAtMall(await asMallManager(), { note: 'Sunday count' });

    expect(count).toMatchObject({
      status: 'open',
      note: 'Sunday count',
      lineCount: 2,
      countedCount: 0,
      lostValue: '0.000',
      foundValue: '0.000',
      startedByName: 'Maha Mall Manager',
      startedAt: clock.toISOString(),
    });
    expect(count.number).toBeGreaterThan(0);
    expect(
      count.lines.map((line) => [line.ingredient.name.en, line.expected, line.counted]),
    ).toEqual([
      ['Flour', '10.000', null],
      ['Mozzarella', '4.000', null],
    ]);
    await expect(
      prisma.auditLog.findMany({ where: { action: 'inventory.count.started' } }),
    ).resolves.toHaveLength(1);
  });

  it('can count only some ingredients', async () => {
    const count = await startAtMall(await asMallManager(), { ingredientIds: [mozzarella.id] });
    expect(count.lines.map((line) => line.ingredient.id)).toEqual([mozzarella.id]);
  });

  it('allows one open count per branch (criterion 4)', async () => {
    const api = await asMallManager();
    await startAtMall(api);

    const again = await api.post(COUNTS, { branchId: world.mall.id });
    expect(again.status).toBe(409);
    expect(errorOf(again).code).toBe('COUNT_ALREADY_OPEN');

    const brandManager = as(app, await signIn(app, 'pizza@x.io'));
    const downtown = await brandManager.post(COUNTS, { branchId: world.downtown.id });
    expect(downtown.status).toBe(201);
  });
});

describe('finishing a count', () => {
  it('sets the stock to what was counted and shows the loss (criterion 2)', async () => {
    const api = await asMallManager();
    const count = await startAtMall(api);

    const saved = countOf(
      await save(api, count.id, [
        { ingredientId: flour.id, counted: '9.5' },
        { ingredientId: mozzarella.id, counted: '4' },
      ]),
    );
    expect(saved.countedCount).toBe(2);
    expect(lineOf(saved, flour.id)).toMatchObject({ counted: '9.500', difference: '-0.500' });

    const res = await api.post(`${COUNTS}/${count.id}/finish`, {});
    expect(res.status).toBe(200);
    const finished = countOf(res);
    expect(finished).toMatchObject({
      status: 'finished',
      finishedByName: 'Maha Mall Manager',
      lostValue: '-0.200',
      foundValue: '0.000',
    });
    expect(lineOf(finished, flour.id)).toMatchObject({
      expected: '10.000',
      counted: '9.500',
      difference: '-0.500',
      value: '-0.200',
    });
    expect(await stockAt(flour.id)).toBe('9.500');
    expect(await stockAt(mozzarella.id)).toBe('4.000');

    const movements = await prisma.stockMovement.findMany();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      ingredientId: flour.id,
      kind: 'count',
      referenceId: count.id,
      note: `Count ${count.number}`,
      byName: 'Maha Mall Manager',
    });
    expect(movements[0]?.quantity.toFixed(3)).toBe('-0.500');
    await expect(
      prisma.auditLog.findMany({ where: { action: 'inventory.count.finished' } }),
    ).resolves.toHaveLength(1);
  });

  it('measures against the stock when it is finished, not when it started (criterion 3)', async () => {
    const api = await asMallManager();
    const count = await startAtMall(api, { ingredientIds: [flour.id] });
    await save(api, count.id, [{ ingredientId: flour.id, counted: '7' }]);
    // 2 kg sold while the count was open.
    await prisma.branchStock.update({
      where: { branchId_ingredientId: { branchId: world.mall.id, ingredientId: flour.id } },
      data: { quantity: '8' },
    });

    const finished = countOf(await api.post(`${COUNTS}/${count.id}/finish`, {}));
    expect(lineOf(finished, flour.id)).toMatchObject({ expected: '8.000', difference: '-1.000' });
    const [movement] = await prisma.stockMovement.findMany();
    expect(movement?.quantity.toFixed(3)).toBe('-1.000');
    expect(await stockAt(flour.id)).toBe('7.000');
  });

  it('leaves the lines not counted as they are, and keeps the cost of that day', async () => {
    const api = await asMallManager();
    const count = await startAtMall(api);
    await save(api, count.id, [{ ingredientId: mozzarella.id, counted: '5' }]);
    await api.post(`${COUNTS}/${count.id}/finish`, {});
    await prisma.ingredient.update({ where: { id: mozzarella.id }, data: { costPerUnit: '9' } });

    const later = countOf(await api.get(`${COUNTS}/${count.id}`));
    expect(later).toMatchObject({ countedCount: 1, foundValue: '3.000' });
    expect(lineOf(later, flour.id)).toMatchObject({ counted: null, difference: null });
    expect(await stockAt(flour.id)).toBe('10.000');
  });

  it('needs something counted, and a cancelled count takes nothing more (criterion 5)', async () => {
    const api = await asMallManager();
    const count = await startAtMall(api);

    const empty = await api.post(`${COUNTS}/${count.id}/finish`, {});
    expect(empty.status).toBe(409);
    expect(errorOf(empty).code).toBe('COUNT_EMPTY');
    expect(countOf(await api.get(`${COUNTS}/${count.id}`)).status).toBe('open');

    expect(messagesOf(await api.post(`${COUNTS}/${count.id}/cancel`, { reason: '' }))).toEqual([
      'reason:NOTE_REQUIRED',
    ]);
    const cancelled = countOf(
      await api.post(`${COUNTS}/${count.id}/cancel`, { reason: 'Started by mistake' }),
    );
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'Started by mistake' });

    const late = await save(api, count.id, [{ ingredientId: flour.id, counted: '1' }]);
    expect(late.status).toBe(409);
    expect(errorOf(late).code).toBe('COUNT_NOT_OPEN');
    expect(await stockAt(flour.id)).toBe('10.000');
    await expect(prisma.stockMovement.count()).resolves.toBe(0);

    // The branch can start a new count once the old one is closed.
    await startAtMall(api);
  });

  it('refuses an ingredient that is not on the count', async () => {
    const api = await asMallManager();
    const count = await startAtMall(api, { ingredientIds: [flour.id] });
    const res = await save(api, count.id, [{ ingredientId: mozzarella.id, counted: '1' }]);
    expect(messagesOf(res)).toEqual(['lines.0.ingredientId:INGREDIENT_NOT_FOUND']);
  });
});

describe('who counts', () => {
  it('lets the purchaser count at their branch only, and hides counts from a cashier (criterion 6)', async () => {
    const purchaser = await asPurchaser();
    const count = await startAtMall(purchaser);
    expect((await purchaser.post(COUNTS, { branchId: world.downtown.id })).status).toBe(404);

    const list = pageSchema(stockCountSummarySchema).parse(
      (await purchaser.get(`${COUNTS}?branchId=${world.mall.id}`)).body,
    );
    expect(list.data.map((row) => row.id)).toEqual([count.id]);

    const cashier = await asCashier();
    expect((await cashier.get(`${COUNTS}?branchId=${world.mall.id}`)).status).toBe(403);
    expect((await cashier.get(`${COUNTS}/${count.id}`)).status).toBe(403);

    const burger = await asBurgerManager();
    expect((await burger.get(`${COUNTS}/${count.id}`)).status).toBe(404);
  });

  it('lists the open count first, then the newest', async () => {
    const api = await asMallManager();
    const first = await startAtMall(api);
    await save(api, first.id, [{ ingredientId: flour.id, counted: '10' }]);
    await api.post(`${COUNTS}/${first.id}/finish`, {});
    const second = await startAtMall(api);
    await api.post(`${COUNTS}/${second.id}/cancel`, { reason: 'Redo' });
    const third = await startAtMall(api);

    const list = pageSchema(stockCountSummarySchema).parse(
      (await api.get(`${COUNTS}?branchId=${world.mall.id}`)).body,
    );
    expect(list.data.map((row) => [row.id, row.status])).toEqual([
      [third.id, 'open'],
      [second.id, 'cancelled'],
      [first.id, 'finished'],
    ]);
  });
});
