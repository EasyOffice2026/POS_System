import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBranch, createBrand, createUser } from '../../test/factories';
import { createTestPrisma, resetDatabase } from '../../test/helpers';
import { createPasswordHasher, hashProfiles } from '../lib/password';
import { syncSystemRoles } from '../lib/roles';
import { applyScope, createScopedClient, TenantViolationError } from './scoped-client';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);

// Brand A has two branches and Brand B has one. Each brand has a user.
interface World {
  brandA: { id: string };
  brandB: { id: string };
  branchA1: { id: string };
  branchA2: { id: string };
  branchB1: { id: string };
}

let world: World;

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await resetDatabase(prisma);
  const brandA = await createBrand(prisma, 'Brand A');
  const brandB = await createBrand(prisma, 'Brand B');
  const branchA1 = await createBranch(prisma, brandA.id, 'A1');
  const branchA2 = await createBranch(prisma, brandA.id, 'A2');
  const branchB1 = await createBranch(prisma, brandB.id, 'B1');
  await createUser(prisma, hasher, {
    roleKey: 'brand_manager',
    brandId: brandA.id,
    email: 'a@x.io',
  });
  await createUser(prisma, hasher, {
    roleKey: 'brand_manager',
    brandId: brandB.id,
    email: 'b@x.io',
  });
  world = { brandA, brandB, branchA1, branchA2, branchB1 };
});

function brandScope(brandId: string) {
  return createScopedClient(prisma, { scope: 'BRAND', brandId, branchIds: [] });
}

function branchScope(brandId: string, branchIds: string[]) {
  return createScopedClient(prisma, { scope: 'BRANCH', brandId, branchIds });
}

const groupScope = () =>
  createScopedClient(prisma, { scope: 'GROUP', brandId: null, branchIds: [] });

describe('reading as a brand-scoped user', () => {
  it('only sees their own brand', async () => {
    const db = brandScope(world.brandA.id);

    expect((await db.brand.findMany()).map((b) => b.id)).toEqual([world.brandA.id]);
    expect(await db.brand.count()).toBe(1);
    expect(await db.brand.findUnique({ where: { id: world.brandB.id } })).toBeNull();
    expect(await db.brand.findFirst({ where: { id: world.brandB.id } })).toBeNull();
  });

  it('only sees the branches and users of their own brand', async () => {
    const db = brandScope(world.brandA.id);

    const branches = await db.branch.findMany({ orderBy: { id: 'asc' } });
    expect(branches.map((b) => b.id)).toEqual([world.branchA1.id, world.branchA2.id]);
    expect(await db.branch.findUnique({ where: { id: world.branchB1.id } })).toBeNull();

    const users = await db.user.findMany();
    expect(users.map((u) => u.email)).toEqual(['a@x.io']);
  });

  it('cannot widen the filter by asking for another brand', async () => {
    const db = brandScope(world.brandA.id);

    expect(await db.branch.findMany({ where: { brandId: world.brandB.id } })).toEqual([]);

    const both = await db.branch.findMany({
      where: { OR: [{ brandId: world.brandA.id }, { brandId: world.brandB.id }] },
    });
    expect(both.every((b) => b.brandId === world.brandA.id)).toBe(true);
    expect(both).toHaveLength(2);
  });

  it('keeps the filter when the query already uses AND', async () => {
    const db = brandScope(world.brandA.id);

    const result = await db.branch.findMany({
      where: { AND: [{ brandId: world.brandB.id }] },
    });

    expect(result).toEqual([]);
  });

  it('applies to counts, aggregates and groups too', async () => {
    const db = brandScope(world.brandA.id);

    expect(await db.branch.count()).toBe(2);
    expect((await db.branch.aggregate({ _count: true }))._count).toBe(2);

    const groups = await db.branch.groupBy({ by: ['brandId'], _count: true });
    expect(groups).toEqual([{ brandId: world.brandA.id, _count: 2 }]);
  });
});

describe('reading as a branch-scoped user', () => {
  it('only sees their assigned branches', async () => {
    const db = branchScope(world.brandA.id, [world.branchA1.id]);

    expect((await db.branch.findMany()).map((b) => b.id)).toEqual([world.branchA1.id]);
    expect(await db.branch.findUnique({ where: { id: world.branchA2.id } })).toBeNull();
    expect(await db.branch.findUnique({ where: { id: world.branchB1.id } })).toBeNull();
  });

  it('does not see brand-level audit rows, only rows of their branches', async () => {
    await prisma.auditLog.createMany({
      data: [
        { brandId: world.brandA.id, branchId: null, action: 'brand.event' },
        { brandId: world.brandA.id, branchId: world.branchA1.id, action: 'a1.event' },
        { brandId: world.brandA.id, branchId: world.branchA2.id, action: 'a2.event' },
        { brandId: world.brandB.id, branchId: world.branchB1.id, action: 'b1.event' },
      ],
    });

    const db = branchScope(world.brandA.id, [world.branchA1.id]);

    expect((await db.auditLog.findMany()).map((row) => row.action)).toEqual(['a1.event']);
  });

  it('sees nothing when no branch is assigned', async () => {
    const db = branchScope(world.brandA.id, []);

    expect(await db.branch.findMany()).toEqual([]);
  });
});

describe('reading as a group user', () => {
  it('sees every brand, branch and user', async () => {
    const db = groupScope();

    expect(await db.brand.count()).toBe(2);
    expect(await db.branch.count()).toBe(3);
    expect(await db.user.count()).toBe(2);
  });
});

describe('writing as a brand-scoped user', () => {
  it('cannot update another brand, and nothing changes', async () => {
    const db = brandScope(world.brandA.id);

    await expect(
      db.branch.update({ where: { id: world.branchB1.id }, data: { isActive: false } }),
    ).rejects.toMatchObject({ code: 'P2025' });

    const untouched = await prisma.branch.findUniqueOrThrow({ where: { id: world.branchB1.id } });
    expect(untouched.isActive).toBe(true);
  });

  it('only changes their own rows with updateMany', async () => {
    const db = brandScope(world.brandA.id);

    const result = await db.branch.updateMany({ data: { isActive: false } });

    expect(result.count).toBe(2);
    expect(await prisma.branch.count({ where: { isActive: false } })).toBe(2);
    const other = await prisma.branch.findUniqueOrThrow({ where: { id: world.branchB1.id } });
    expect(other.isActive).toBe(true);
  });

  it('cannot delete another brand, and only deletes their own rows with deleteMany', async () => {
    const db = brandScope(world.brandA.id);

    await expect(db.branch.delete({ where: { id: world.branchB1.id } })).rejects.toMatchObject({
      code: 'P2025',
    });

    const result = await db.branch.deleteMany();
    expect(result.count).toBe(2);
    expect(await prisma.branch.count()).toBe(1);
  });

  it('cannot move a row to another brand', async () => {
    const db = brandScope(world.brandA.id);

    await expect(
      db.branch.update({ where: { id: world.branchA1.id }, data: { brandId: world.brandB.id } }),
    ).rejects.toBeInstanceOf(TenantViolationError);
    await expect(
      db.branch.update({
        where: { id: world.branchA1.id },
        data: { brandId: { set: world.brandB.id } },
      }),
    ).rejects.toBeInstanceOf(TenantViolationError);
  });

  it('cannot create rows for another brand', async () => {
    const db = brandScope(world.brandA.id);

    await expect(
      db.branch.create({
        data: { brandId: world.brandB.id, name: { en: 'Sneaky', ar: 'خفي' } },
      }),
    ).rejects.toBeInstanceOf(TenantViolationError);
    await expect(
      db.branch.createMany({
        data: [{ brandId: world.brandB.id, name: { en: 'Sneaky', ar: 'خفي' } }],
      }),
    ).rejects.toBeInstanceOf(TenantViolationError);

    expect(await prisma.branch.count({ where: { brandId: world.brandB.id } })).toBe(1);
  });

  it('creates rows in their own brand, filling in the brand when it is left out', async () => {
    const db = brandScope(world.brandA.id);

    const created = await db.branch.create({
      data: { name: { en: 'New', ar: 'جديد' } } as never,
    });

    expect(created.brandId).toBe(world.brandA.id);
  });

  it('cannot create brands', async () => {
    const db = brandScope(world.brandA.id);

    await expect(
      db.brand.create({ data: { name: { en: 'New brand', ar: 'علامة جديدة' } } }),
    ).rejects.toBeInstanceOf(TenantViolationError);
  });

  it('cannot reach another brand through upsert', async () => {
    const db = brandScope(world.brandA.id);

    await expect(
      db.branch.upsert({
        where: { id: world.branchB1.id },
        update: { isActive: false },
        create: { brandId: world.brandB.id, name: { en: 'x', ar: 'x' } },
      }),
    ).rejects.toBeInstanceOf(TenantViolationError);
  });
});

describe('writing as a branch-scoped user', () => {
  it('cannot create or move rows into a branch that is not assigned', async () => {
    await prisma.auditLog.create({
      data: { brandId: world.brandA.id, branchId: world.branchA1.id, action: 'x' },
    });
    const db = branchScope(world.brandA.id, [world.branchA1.id]);

    await expect(
      db.auditLog.create({
        data: { brandId: world.brandA.id, branchId: world.branchA2.id, action: 'y' },
      }),
    ).rejects.toBeInstanceOf(TenantViolationError);
    await expect(
      db.auditLog.updateMany({ data: { branchId: world.branchA2.id } }),
    ).rejects.toBeInstanceOf(TenantViolationError);
  });

  it('cannot create branches', async () => {
    const db = branchScope(world.brandA.id, [world.branchA1.id]);

    await expect(
      db.branch.create({ data: { brandId: world.brandA.id, name: { en: 'x', ar: 'x' } } }),
    ).rejects.toBeInstanceOf(TenantViolationError);
  });
});

describe('writing as a group user', () => {
  it('can create brands and write to any brand', async () => {
    const db = groupScope();

    const brand = await db.brand.create({ data: { name: { en: 'New', ar: 'جديد' } } });
    const branch = await db.branch.create({
      data: { brandId: brand.id, name: { en: 'New branch', ar: 'فرع جديد' } },
    });

    expect(branch.brandId).toBe(brand.id);
    await db.branch.update({ where: { id: world.branchB1.id }, data: { isActive: false } });
  });
});

describe('what the scoped client refuses', () => {
  const db = () => brandScope(world.brandA.id);

  it('loading related rows with include or a nested select', async () => {
    await expect(db().brand.findMany({ include: { branches: true } } as never)).rejects.toThrow(
      /include/,
    );
    await expect(
      db().brand.findMany({ select: { id: true, branches: { select: { id: true } } } } as never),
    ).rejects.toThrow(/related rows/);
  });

  it('plain column selects are fine', async () => {
    const rows = await db().brand.findMany({ select: { id: true } });

    expect(rows).toEqual([{ id: world.brandA.id }]);
  });

  it('nested writes', async () => {
    await expect(
      db().user.create({
        data: {
          roleId: '00000000-0000-7000-8000-000000000000',
          name: 'x',
          branches: { create: [{ branchId: world.branchA1.id }] },
        },
      }),
    ).rejects.toThrow(/Nested writes/);
    await expect(
      db().branch.update({
        where: { id: world.branchA1.id },
        data: { brand: { connect: { id: world.brandB.id } } },
      }),
    ).rejects.toThrow(/Nested writes/);
  });

  it('raw SQL', async () => {
    await expect(db().$queryRaw`select 1`).rejects.toThrow(/Raw queries/);
    await expect(db().$executeRawUnsafe('delete from branches')).rejects.toThrow(/Raw queries/);
    expect(await prisma.branch.count()).toBe(3);
  });

  it('models without tenant rules', async () => {
    await expect(db().refreshToken.findMany()).rejects.toThrow(/no tenant rules/);
    await expect(db().userBranch.findMany()).rejects.toThrow(/no tenant rules/);
  });

  it('writes to the built-in roles, which are read-only', async () => {
    expect(await db().role.count()).toBe(7);
    await expect(db().role.deleteMany()).rejects.toThrow(/read-only/);
  });
});

describe('transactions', () => {
  it('keep the limit inside an interactive transaction', async () => {
    const db = brandScope(world.brandA.id);

    const branches = await db.$transaction(async (tx) => tx.branch.findMany());

    expect(branches).toHaveLength(2);
  });
});

describe('createScopedClient', () => {
  it('needs a brand id for brand and branch scope', () => {
    expect(() =>
      createScopedClient(prisma, { scope: 'BRAND', brandId: null, branchIds: [] }),
    ).toThrow(/brand id/);
    expect(() =>
      createScopedClient(prisma, { scope: 'BRANCH', brandId: null, branchIds: [] }),
    ).toThrow(/brand id/);
  });
});

describe('applyScope', () => {
  const brandCtx = { scope: 'BRAND', brandId: 'brand-1', branchIds: [] } as const;

  it('keeps unique fields at the top level so findUnique still works', () => {
    const args = applyScope('Branch', 'findUnique', { where: { id: 'b1' } }, brandCtx);

    expect(args.where).toEqual({ id: 'b1', AND: [{ AND: [{ brandId: 'brand-1' }] }] });
  });

  it('merges with an AND the caller already wrote', () => {
    const args = applyScope('Branch', 'findMany', { where: { AND: { isActive: true } } }, brandCtx);

    expect(args.where).toEqual({
      AND: [{ isActive: true }, { AND: [{ brandId: 'brand-1' }] }],
    });
  });

  it('does not change the arguments it was given', () => {
    const original = { where: { isActive: true } };

    applyScope('Branch', 'findMany', original, brandCtx);

    expect(original).toEqual({ where: { isActive: true } });
  });

  it('leaves queries unfiltered for a group user', () => {
    const args = applyScope(
      'Branch',
      'findMany',
      { where: { isActive: true } },
      { scope: 'GROUP', brandId: null, branchIds: [] },
    );

    expect(args.where).toEqual({ isActive: true });
  });

  it('refuses an operation it does not know', () => {
    expect(() => applyScope('Branch', 'findRaw', {}, brandCtx)).toThrow(/not supported/);
  });
});
