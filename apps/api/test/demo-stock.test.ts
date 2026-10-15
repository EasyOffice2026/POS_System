import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedDemoStock } from '../prisma/demo-stock';
import { createPasswordHasher, hashProfiles } from '../src/lib/password';
import { syncSystemRoles } from '../src/lib/roles';
import { createTestPrisma, resetDatabase } from './helpers';
import { createMenuWorld, type MenuWorld } from './menu-world';

// The demo stock of the seed (prisma/demo-stock.ts), for the acceptance tests of stock.
const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
let world: MenuWorld;

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  world = await createMenuWorld(prisma, hasher);
});

const seed = () => seedDemoStock(prisma, world.pizza.id, [world.mall.id, world.downtown.id]);

describe('the demo stock', () => {
  it('gives both branches their opening stock, the dishes their recipes, and two suppliers', async () => {
    await seed();
    await expect(prisma.ingredient.count()).resolves.toBe(6);
    const mall = await prisma.branchStock.findMany({ where: { branchId: world.mall.id } });
    expect(mall).toHaveLength(6);
    await expect(
      prisma.stockMovement.count({ where: { kind: 'received', note: 'Opening stock (demo)' } }),
    ).resolves.toBe(12);
    // The test menu has a Margherita, a Pepperoni and a Cola.
    const margherita = await prisma.recipeLine.findMany({
      where: { itemId: world.items.margherita.id },
    });
    expect(margherita).toHaveLength(3);
    await expect(prisma.recipeLine.count({ where: { itemId: world.items.cola.id } })).resolves.toBe(
      1,
    );
    await expect(prisma.supplier.count()).resolves.toBe(2);
    await expect(prisma.supplierPrice.count()).resolves.toBe(6);
  });

  it('can be written again without copies, and keeps the stock the testers changed', async () => {
    await seed();
    const row = await prisma.branchStock.findFirstOrThrow({ where: { branchId: world.mall.id } });
    await prisma.branchStock.update({
      where: { branchId_ingredientId: { branchId: row.branchId, ingredientId: row.ingredientId } },
      data: { quantity: '1.500' },
    });

    await seed();
    await expect(prisma.ingredient.count()).resolves.toBe(6);
    await expect(prisma.stockMovement.count()).resolves.toBe(12);
    await expect(prisma.recipeLine.count()).resolves.toBe(8);
    const after = await prisma.branchStock.findUniqueOrThrow({
      where: { branchId_ingredientId: { branchId: row.branchId, ingredientId: row.ingredientId } },
    });
    expect(after.quantity.toFixed(3)).toBe('1.500');
  });
});
