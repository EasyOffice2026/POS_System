import { systemRoles } from '@pos/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestPrisma } from '../../test/helpers';
import { syncSystemRoles } from './roles';

const prisma = createTestPrisma();

afterAll(() => prisma.$disconnect());

describe('syncSystemRoles', () => {
  it('writes every built-in role with its scope and permissions', async () => {
    await syncSystemRoles(prisma);

    const roles = await prisma.role.findMany({ orderBy: { key: 'asc' } });
    expect(roles.map((role) => role.key)).toEqual(systemRoles.map((role) => role.key).sort());

    const cashier = roles.find((role) => role.key === 'cashier');
    expect(cashier?.scope).toBe('BRANCH');
    expect(cashier?.permissions).toEqual(['menu:read']);
  });

  it('can run again without creating duplicates', async () => {
    await syncSystemRoles(prisma);
    await syncSystemRoles(prisma);

    expect(await prisma.role.count()).toBe(systemRoles.length);
  });

  it('puts a changed role definition back to what the code says', async () => {
    await syncSystemRoles(prisma);
    await prisma.role.update({
      where: { key: 'cashier' },
      data: { permissions: ['brands:write'] },
    });

    await syncSystemRoles(prisma);

    const cashier = await prisma.role.findUniqueOrThrow({ where: { key: 'cashier' } });
    expect(cashier.permissions).toEqual(['menu:read']);
  });
});
