import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBranch, createBrand, createUser } from '../../test/factories';
import { createTestPrisma, resetDatabase } from '../../test/helpers';
import { createPasswordHasher, hashProfiles } from './password';
import { syncSystemRoles } from './roles';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);

beforeAll(() => syncSystemRoles(prisma));
beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

describe('database constraints', () => {
  it('does not allow two users with the same email', async () => {
    await createUser(prisma, hasher, { roleKey: 'group_admin', email: 'a@pos.local' });

    await expect(
      createUser(prisma, hasher, { roleKey: 'group_admin', email: 'a@pos.local' }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('keeps staff codes unique inside one brand only', async () => {
    const pizza = await createBrand(prisma, 'Pizza');
    const burger = await createBrand(prisma, 'Burger');
    await createUser(prisma, hasher, { roleKey: 'cashier', brandId: pizza.id, staffCode: '1001' });

    await createUser(prisma, hasher, { roleKey: 'cashier', brandId: burger.id, staffCode: '1001' });
    await expect(
      createUser(prisma, hasher, { roleKey: 'cashier', brandId: pizza.id, staffCode: '1001' }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('does not allow a brand to be deleted while it has branches', async () => {
    const brand = await createBrand(prisma);
    await createBranch(prisma, brand.id);

    await expect(prisma.brand.delete({ where: { id: brand.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
  });

  it('removes branch assignments together with the user', async () => {
    const brand = await createBrand(prisma);
    const branch = await createBranch(prisma, brand.id);
    const user = await createUser(prisma, hasher, {
      roleKey: 'cashier',
      brandId: brand.id,
      branchIds: [branch.id],
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.userBranch.count()).toBe(0);
  });

  it('stores bilingual names as JSON and reads them back', async () => {
    const brand = await prisma.brand.create({
      data: { name: { en: 'Pizza Palace', ar: 'بيتزا بالاس' } },
    });

    const found = await prisma.brand.findUniqueOrThrow({ where: { id: brand.id } });
    expect(found.name).toEqual({ en: 'Pizza Palace', ar: 'بيتزا بالاس' });
  });
});
