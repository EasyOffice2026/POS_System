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
  await prisma.auditLog.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.userBranch.deleteMany();
  await prisma.user.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.brand.deleteMany();
}
