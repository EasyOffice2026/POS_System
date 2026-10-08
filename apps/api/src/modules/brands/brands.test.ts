import { branchSchema, brandSchema, pageSchema } from '@pos/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { createBranch, createBrand, createUser, TEST_PASSWORD } from '../../../test/factories';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

const prisma = createTestPrisma();
const config = testConfig({ AUTH_RATE_LIMIT_MAX: '1000' });
const hasher = createPasswordHasher(hashProfiles.fast);
const app = createApp({ prisma, config });

interface World {
  pizza: { id: string };
  burger: { id: string };
  pizzaBranchIds: string[];
  burgerBranchIds: string[];
}

let world: World;

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await resetDatabase(prisma);
  const pizza = await createBrand(prisma, 'Pizza');
  const burger = await createBrand(prisma, 'Burger');
  const pizzaBranches = [
    await createBranch(prisma, pizza.id, 'Pizza Mall'),
    await createBranch(prisma, pizza.id, 'Pizza Downtown'),
    await createBranch(prisma, pizza.id, 'Pizza Airport'),
  ];
  const burgerBranches = [
    await createBranch(prisma, burger.id, 'Burger Corniche'),
    await createBranch(prisma, burger.id, 'Burger Mall'),
  ];
  world = {
    pizza,
    burger,
    pizzaBranchIds: pizzaBranches.map((b) => b.id),
    burgerBranchIds: burgerBranches.map((b) => b.id),
  };

  await createUser(prisma, hasher, { roleKey: 'group_admin', email: 'admin@x.io' });
  await createUser(prisma, hasher, {
    roleKey: 'brand_manager',
    brandId: pizza.id,
    email: 'pizza@x.io',
  });
  await createUser(prisma, hasher, {
    roleKey: 'branch_manager',
    brandId: pizza.id,
    branchIds: [pizzaBranches[0]?.id ?? ''],
    email: 'mall-manager@x.io',
  });
  await createUser(prisma, hasher, {
    roleKey: 'cashier',
    brandId: pizza.id,
    branchIds: [pizzaBranches[0]?.id ?? ''],
    email: 'cashier@x.io',
  });
});

async function tokenFor(email: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ type: 'password', email, password: TEST_PASSWORD });
  return (res.body as { accessToken: string }).accessToken;
}

async function get(path: string, email?: string) {
  const req = request(app).get(path);
  if (email) req.set('Authorization', `Bearer ${await tokenFor(email)}`);
  return req;
}

const brandPage = pageSchema(brandSchema);
const branchPage = pageSchema(branchSchema);

describe('GET /brands', () => {
  it('shows a group admin every brand', async () => {
    const res = await get('/api/v1/brands', 'admin@x.io');

    expect(res.status).toBe(200);
    const page = brandPage.parse(res.body);
    expect(page.data.map((b) => b.id).sort()).toEqual([world.pizza.id, world.burger.id].sort());
    expect(page.nextCursor).toBeNull();
  });

  it('shows a brand manager only their own brand', async () => {
    const res = await get('/api/v1/brands', 'pizza@x.io');

    expect(res.status).toBe(200);
    expect(brandPage.parse(res.body).data.map((b) => b.id)).toEqual([world.pizza.id]);
  });

  it('returns the bilingual name', async () => {
    const res = await get('/api/v1/brands', 'pizza@x.io');

    expect(brandPage.parse(res.body).data[0]?.name).toEqual({ en: 'Pizza', ar: 'Pizza (ar)' });
  });

  it('is not allowed for roles without brands:read', async () => {
    for (const email of ['cashier@x.io', 'mall-manager@x.io']) {
      const res = await get('/api/v1/brands', email);

      expect(res.status).toBe(403);
      expect((res.body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    }
  });

  it('needs a signed-in person', async () => {
    const res = await get('/api/v1/brands');

    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
  });
});

describe('GET /brands/:id/branches', () => {
  it('shows a brand manager the branches of their brand', async () => {
    const res = await get(`/api/v1/brands/${world.pizza.id}/branches`, 'pizza@x.io');

    expect(res.status).toBe(200);
    const ids = branchPage.parse(res.body).data.map((b) => b.id);
    expect(ids.sort()).toEqual([...world.pizzaBranchIds].sort());
  });

  it("answers 'not found' for the branches of another brand", async () => {
    const res = await get(`/api/v1/brands/${world.burger.id}/branches`, 'pizza@x.io');

    expect(res.status).toBe(404);
    expect((res.body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('answers the same for a brand that does not exist', async () => {
    const missing = await get(
      '/api/v1/brands/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b/branches',
      'pizza@x.io',
    );
    const other = await get(`/api/v1/brands/${world.burger.id}/branches`, 'pizza@x.io');

    expect(missing.status).toBe(other.status);
    expect(missing.body).toEqual(other.body);
  });

  it('shows a group admin the branches of any brand', async () => {
    const res = await get(`/api/v1/brands/${world.burger.id}/branches`, 'admin@x.io');

    const ids = branchPage.parse(res.body).data.map((b) => b.id);
    expect(ids.sort()).toEqual([...world.burgerBranchIds].sort());
  });

  it('shows a branch manager only the branch they are assigned to', async () => {
    const res = await get(`/api/v1/brands/${world.pizza.id}/branches`, 'mall-manager@x.io');

    expect(res.status).toBe(200);
    expect(branchPage.parse(res.body).data.map((b) => b.id)).toEqual([world.pizzaBranchIds[0]]);
  });

  it('is not allowed for a cashier', async () => {
    const res = await get(`/api/v1/brands/${world.pizza.id}/branches`, 'cashier@x.io');

    expect(res.status).toBe(403);
  });

  it('rejects an id that is not a UUID', async () => {
    const res = await get('/api/v1/brands/not-a-uuid/branches', 'pizza@x.io');

    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('cursor pages', () => {
  it('walks through every brand in order, with no repeats', async () => {
    for (let n = 1; n <= 5; n += 1) {
      await createBrand(prisma, `Extra ${n}`);
    }
    const token = await tokenFor('admin@x.io');
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const query: string = cursor ? `?limit=3&cursor=${cursor}` : '?limit=3';
      const res = await request(app)
        .get(`/api/v1/brands${query}`)
        .set('Authorization', `Bearer ${token}`);
      const page = brandPage.parse(res.body);
      expect(page.data.length).toBeLessThanOrEqual(3);
      seen.push(...page.data.map((b) => b.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);

    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(seen).toEqual([...seen].sort());
    expect(pages).toBe(3);
  });

  it('has no next cursor on an exact last page', async () => {
    const res = await get('/api/v1/brands?limit=2', 'admin@x.io');

    const page = brandPage.parse(res.body);
    expect(page.data).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('pages the branches of a brand too', async () => {
    const token = await tokenFor('admin@x.io');

    const first = await request(app)
      .get(`/api/v1/brands/${world.pizza.id}/branches?limit=2`)
      .set('Authorization', `Bearer ${token}`);
    const firstPage = branchPage.parse(first.body);
    const second = await request(app)
      .get(`/api/v1/brands/${world.pizza.id}/branches?limit=2&cursor=${firstPage.nextCursor}`)
      .set('Authorization', `Bearer ${token}`);
    const secondPage = branchPage.parse(second.body);

    expect(firstPage.data).toHaveLength(2);
    expect(secondPage.data).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
  });

  it.each(['limit=0', 'limit=101', 'limit=abc', 'cursor=not-a-uuid'])(
    'rejects the query "%s"',
    async (query) => {
      const res = await get(`/api/v1/brands?${query}`, 'admin@x.io');

      expect(res.status).toBe(400);
    },
  );
});
