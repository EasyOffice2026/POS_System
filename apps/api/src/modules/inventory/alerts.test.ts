import { branchStockAlertsSchema } from '@pos/shared';
import type request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../app';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { as, createUsersWorld, signIn, type UsersWorld } from '../../../test/users-world';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const app = createApp({ prisma, config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }) });

let world: UsersWorld;
let flour: { id: string };
let mozzarella: { id: string };

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  world = await createUsersWorld(prisma, hasher);
  const ingredient = (brandId: string, en: string, lowLevel: string) =>
    prisma.ingredient.create({
      data: {
        brandId,
        name: { en, ar: `${en} (ar)` },
        searchText: en.toLowerCase(),
        unit: 'kg',
        lowLevel,
      },
    });
  flour = await ingredient(world.pizza.id, 'Flour', '5');
  mozzarella = await ingredient(world.pizza.id, 'Mozzarella', '2');
  // Not watched: a level of 0 (criterion 2).
  await ingredient(world.pizza.id, 'Basil', '0');
  const buns = await ingredient(world.burger.id, 'Buns', '10');
  await setStock(world.airport.id, buns.id, '1');
});

const ALERTS = '/api/v1/inventory/alerts';
const alertsOf = (res: request.Response) =>
  z.object({ data: z.array(branchStockAlertsSchema) }).parse(res.body).data;
const summaryOf = (res: request.Response) =>
  alertsOf(res).map((alerts) => [
    alerts.branch.name.en,
    alerts.items.map(
      (item) => `${item.ingredient.name.en} ${item.status} ${item.quantity}/${item.level}`,
    ),
  ]);

function setStock(branchId: string, ingredientId: string, quantity: string, lowLevel?: string) {
  const brandId = branchId === world.airport.id ? world.burger.id : world.pizza.id;
  return prisma.branchStock.upsert({
    where: { branchId_ingredientId: { branchId, ingredientId } },
    create: { brandId, branchId, ingredientId, quantity, lowLevel: lowLevel ?? null },
    update: { quantity, ...(lowLevel === undefined ? {} : { lowLevel }) },
  });
}

describe('GET /inventory/alerts', () => {
  it('lists what is out first, then what is low, and leaves unwatched ones out (criteria 1 and 2)', async () => {
    await setStock(world.mall.id, mozzarella.id, '0.5');
    await setStock(world.mall.id, flour.id, '0');
    await setStock(world.downtown.id, flour.id, '20');
    await setStock(world.downtown.id, mozzarella.id, '10');

    const res = await as(app, await signIn(app, 'pizza@x.io')).get(ALERTS);
    expect(res.status).toBe(200);
    expect(summaryOf(res)).toEqual([
      ['Pizza Mall', ['Flour out 0.000/5.000', 'Mozzarella low 0.500/2.000']],
    ]);
  });

  it('uses the level of the branch when it has its own (criterion 3)', async () => {
    await setStock(world.mall.id, flour.id, '8', '10');
    await setStock(world.mall.id, mozzarella.id, '10');
    await setStock(world.downtown.id, flour.id, '8');
    await setStock(world.downtown.id, mozzarella.id, '10');

    const res = await as(app, await signIn(app, 'pizza@x.io')).get(ALERTS);
    expect(summaryOf(res)).toEqual([['Pizza Mall', ['Flour low 8.000/10.000']]]);
  });

  it('counts a branch that never received an ingredient as out, and puts it first', async () => {
    await setStock(world.mall.id, flour.id, '1');
    await setStock(world.mall.id, mozzarella.id, '10');

    const res = await as(app, await signIn(app, 'pizza@x.io')).get(ALERTS);
    expect(summaryOf(res)).toEqual([
      ['Pizza Downtown', ['Flour out 0.000/5.000', 'Mozzarella out 0.000/2.000']],
      ['Pizza Mall', ['Flour low 1.000/5.000']],
    ]);
  });

  it('shows a branch manager their branch and another brand nothing of this one (criterion 4)', async () => {
    await setStock(world.mall.id, flour.id, '10');
    await setStock(world.mall.id, mozzarella.id, '1');

    const mall = await as(app, await signIn(app, 'mall-manager@x.io')).get(ALERTS);
    expect(summaryOf(mall)).toEqual([['Pizza Mall', ['Mozzarella low 1.000/2.000']]]);

    const burger = await as(app, await signIn(app, 'burger@x.io')).get(ALERTS);
    expect(summaryOf(burger)).toEqual([['Burger Airport', ['Buns low 1.000/10.000']]]);

    const admin = await as(app, await signIn(app, 'admin@x.io')).get(
      `${ALERTS}?brandId=${world.burger.id}`,
    );
    expect(summaryOf(admin)).toEqual([['Burger Airport', ['Buns low 1.000/10.000']]]);

    const cashier = await as(app, await signIn(app, 'cashier@x.io')).get(ALERTS);
    expect(cashier.status).toBe(403);
  });

  it('goes away when the branch receives enough, and skips inactive branches (criterion 5)', async () => {
    await setStock(world.mall.id, flour.id, '1');
    await setStock(world.mall.id, mozzarella.id, '10');
    await prisma.branch.update({ where: { id: world.downtown.id }, data: { isActive: false } });
    const manager = as(app, await signIn(app, 'mall-manager@x.io'));
    expect(alertsOf(await manager.get(ALERTS))).toHaveLength(1);

    const received = await manager.post('/api/v1/inventory/movements', {
      branchId: world.mall.id,
      ingredientId: flour.id,
      kind: 'received',
      quantity: '20',
    });
    expect(received.status).toBe(200);
    expect(alertsOf(await manager.get(ALERTS))).toEqual([]);
  });
});
