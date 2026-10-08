import type { RoleKey } from '@pos/shared';
import type { PasswordHasher } from '../src/lib/password';
import type { PrismaClient } from '../src/lib/prisma';

export const TEST_PASSWORD = 'Password123!';

export function createBrand(prisma: PrismaClient, name = 'Test Brand') {
  return prisma.brand.create({ data: { name: { en: name, ar: `${name} (ar)` } } });
}

export function createBranch(prisma: PrismaClient, brandId: string, name = 'Test Branch') {
  return prisma.branch.create({ data: { brandId, name: { en: name, ar: `${name} (ar)` } } });
}

interface UserInput {
  roleKey: RoleKey;
  brandId?: string | null;
  branchIds?: string[];
  name?: string;
  email?: string;
  password?: string;
  staffCode?: string;
  pin?: string;
}

// Needs the built-in roles in the database (call syncSystemRoles first).
export async function createUser(prisma: PrismaClient, hasher: PasswordHasher, input: UserInput) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: input.roleKey } });
  const { brandId, branchIds = [] } = input;
  if (branchIds.length > 0 && !brandId) {
    throw new Error('A user with branches needs a brand id.');
  }

  return prisma.user.create({
    data: {
      brandId: input.brandId ?? null,
      roleId: role.id,
      name: input.name ?? input.roleKey,
      email: input.email ?? null,
      staffCode: input.staffCode ?? null,
      passwordHash: input.email ? await hasher.hash(input.password ?? TEST_PASSWORD) : null,
      pinHash: input.pin ? await hasher.hash(input.pin) : null,
      branches: {
        create: branchIds.map((branchId) => ({ branchId, brandId: brandId as string })),
      },
    },
  });
}
