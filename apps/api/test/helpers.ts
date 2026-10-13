import { inject } from 'vitest';
import { type Config, loadConfig } from '../src/config';
import { createPrismaClient, type PrismaClient } from '../src/lib/prisma';

export function createTestPrisma(): PrismaClient {
  return createPrismaClient(inject('databaseUrl'));
}

// Fast hashing and a fixed secret. Never use these values outside tests.
export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    PASSWORD_HASH_PROFILE: 'fast',
    JWT_ACCESS_SECRET: 'test-only-access-token-secret-0123456789abcdef',
    DATABASE_URL: inject('databaseUrl'),
    ...overrides,
  });
}

// Empties every table except the built-in roles, children before parents.
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.stockMovement.deleteMany();
  await prisma.branchStock.deleteMany();
  await prisma.ingredient.deleteMany();
  await prisma.refund.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.orderLine.deleteMany();
  await prisma.kitchenTicket.deleteMany();
  await prisma.order.deleteMany();
  await prisma.orderCounter.deleteMany();
  await prisma.comboSlotOption.deleteMany();
  await prisma.comboSlot.deleteMany();
  await prisma.combo.deleteMany();
  await prisma.branchMenuItem.deleteMany();
  await prisma.modifier.deleteMany();
  await prisma.modifierGroup.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.menuCategory.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.userBranch.deleteMany();
  await prisma.user.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.brand.deleteMany();
}
