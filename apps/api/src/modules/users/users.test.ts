import { adminUserSchema, pageSchema } from '@pos/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { createUser } from '../../../test/factories';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { as, createUsersWorld, errorOf, signIn, type UsersWorld } from '../../../test/users-world';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const app = createApp({ prisma, config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }) });
const userPage = pageSchema(adminUserSchema);

let world: UsersWorld;

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  world = await createUsersWorld(prisma, hasher);
});

async function listAs(email: string, query = '') {
  const res = await as(app, await signIn(app, email)).get(`/api/v1/users${query}`);
  return res;
}

const namesOf = (res: { body: unknown }) => userPage.parse(res.body).data.map((user) => user.name);

describe('GET /users: who sees whom', () => {
  it('shows a group admin every person, sorted by name', async () => {
    const res = await listAs('admin@x.io');

    expect(res.status).toBe(200);
    expect(namesOf(res)).toEqual([
      'Amal Pizza Manager',
      'Bashir Burger Manager',
      'Dana Downtown',
      'Maha Mall Manager',
      'Omar Burger Cashier',
      'Sara Cashier',
      'Zoe Group Admin',
    ]);
  });

  it('shows a brand manager only the people of their own brand', async () => {
    const res = await listAs('pizza@x.io');

    expect(namesOf(res)).toEqual([
      'Amal Pizza Manager',
      'Dana Downtown',
      'Maha Mall Manager',
      'Sara Cashier',
    ]);
  });

  it('shows a branch manager only the people who work at their branches', async () => {
    const res = await listAs('mall-manager@x.io');

    expect(res.status).toBe(200);
    expect(namesOf(res)).toEqual(['Maha Mall Manager', 'Sara Cashier']);
  });

  it('shows a branch manager only their own branch for a person who works at several', async () => {
    await prisma.userBranch.create({
      data: {
        userId: world.users.cashier.id,
        branchId: world.downtown.id,
        brandId: world.pizza.id,
      },
    });

    const res = await listAs('mall-manager@x.io');

    const sara = userPage.parse(res.body).data.find((user) => user.name === 'Sara Cashier');
    expect(sara?.branchIds).toEqual([world.mall.id]);
  });

  it('is not allowed for a cashier', async () => {
    const res = await listAs('cashier@x.io');

    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe('FORBIDDEN');
  });

  it('needs a signed-in person', async () => {
    expect((await request(app).get('/api/v1/users')).status).toBe(401);
  });

  it('never contains a password, a PIN or their hashes', async () => {
    const res = await listAs('admin@x.io');

    expect(JSON.stringify(res.body)).not.toMatch(/scrypt|passwordHash|pinHash/);
  });

  it('says whether a person has a password and a PIN', async () => {
    const res = await listAs('pizza@x.io');

    const byName = new Map(userPage.parse(res.body).data.map((user) => [user.name, user]));
    expect(byName.get('Sara Cashier')).toMatchObject({ hasPassword: true, hasPin: true });
    expect(byName.get('Dana Downtown')).toMatchObject({ hasPassword: false, hasPin: true });
    expect(byName.get('Amal Pizza Manager')).toMatchObject({ hasPassword: true, hasPin: false });
  });

  it('describes the role and the branches of each person', async () => {
    const res = await listAs('pizza@x.io');

    const sara = userPage.parse(res.body).data.find((user) => user.name === 'Sara Cashier');
    expect(sara).toMatchObject({
      brandId: world.pizza.id,
      staffCode: '1001',
      branchIds: [world.mall.id],
      role: { key: 'cashier', name: 'Cashier', scope: 'BRANCH' },
      isActive: true,
      lockedUntil: null,
    });
  });
});

describe('GET /users: filters', () => {
  it('filters by role', async () => {
    const res = await listAs('admin@x.io', '?role=cashier');

    expect(namesOf(res)).toEqual(['Dana Downtown', 'Omar Burger Cashier', 'Sara Cashier']);
  });

  it('filters by branch', async () => {
    const res = await listAs('pizza@x.io', `?branchId=${world.downtown.id}`);

    expect(namesOf(res)).toEqual(['Dana Downtown']);
  });

  it('lets a group admin narrow by brand', async () => {
    const res = await listAs('admin@x.io', `?brandId=${world.burger.id}`);

    expect(namesOf(res)).toEqual(['Bashir Burger Manager', 'Omar Burger Cashier']);
  });

  it('does not let a brand manager reach another brand through the brand filter', async () => {
    const res = await listAs('pizza@x.io', `?brandId=${world.burger.id}`);

    expect(namesOf(res)).toEqual([]);
  });

  it('searches the name, email and staff code, ignoring case', async () => {
    expect(namesOf(await listAs('admin@x.io', '?q=SARA'))).toEqual(['Sara Cashier']);
    expect(namesOf(await listAs('admin@x.io', '?q=mall-manager'))).toEqual(['Maha Mall Manager']);
    expect(namesOf(await listAs('admin@x.io', '?q=1002'))).toEqual(['Dana Downtown']);
  });

  it('filters by status', async () => {
    await prisma.user.update({
      where: { id: world.users.downtownCashier.id },
      data: { isActive: false },
    });
    await prisma.user.update({
      where: { id: world.users.cashier.id },
      data: { lockedUntil: new Date(Date.now() + 60 * 60 * 1000) },
    });
    // A lock that has run out does not count as locked.
    await prisma.user.update({
      where: { id: world.users.burgerCashier.id },
      data: { lockedUntil: new Date(Date.now() - 60 * 1000) },
    });

    expect(namesOf(await listAs('admin@x.io', '?status=inactive'))).toEqual(['Dana Downtown']);
    expect(namesOf(await listAs('admin@x.io', '?status=locked'))).toEqual(['Sara Cashier']);
    expect(namesOf(await listAs('admin@x.io', '?status=active'))).toHaveLength(6);
  });

  it('shows the end of a lock only while it lasts', async () => {
    const until = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.user.update({
      where: { id: world.users.cashier.id },
      data: { lockedUntil: until },
    });
    await prisma.user.update({
      where: { id: world.users.burgerCashier.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });

    const users = userPage.parse((await listAs('admin@x.io')).body).data;

    expect(users.find((u) => u.name === 'Sara Cashier')?.lockedUntil).toBe(until.toISOString());
    expect(users.find((u) => u.name === 'Omar Burger Cashier')?.lockedUntil).toBeNull();
  });

  it.each(['?role=owner', '?status=gone', '?q=', '?branchId=x', '?limit=0'])(
    'rejects the query %s',
    async (query) => {
      expect((await listAs('admin@x.io', query)).status).toBe(400);
    },
  );
});

describe('GET /users: pages', () => {
  it('walks through every person in order, with no repeats', async () => {
    for (let n = 1; n <= 5; n += 1) {
      await createUser(prisma, hasher, {
        roleKey: 'cashier',
        name: `Extra ${n}`,
        brandId: world.pizza.id,
        branchIds: [world.mall.id],
        staffCode: `90${n}`,
      });
    }
    const token = await signIn(app, 'admin@x.io');
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const query: string = cursor ? `?limit=4&cursor=${cursor}` : '?limit=4';
      const page = userPage.parse((await as(app, token).get(`/api/v1/users${query}`)).body);
      expect(page.data.length).toBeLessThanOrEqual(4);
      seen.push(...page.data.map((user) => user.name));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);

    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
    expect(seen).toEqual([...seen].sort((a, b) => a.localeCompare(b, 'en')));
    expect(pages).toBe(3);
  });
});

describe('GET /users/:id', () => {
  it('returns one person of the same brand', async () => {
    const token = await signIn(app, 'pizza@x.io');

    const res = await as(app, token).get(`/api/v1/users/${world.users.cashier.id}`);

    expect(res.status).toBe(200);
    expect(adminUserSchema.parse(res.body).name).toBe('Sara Cashier');
  });

  it('answers not found for a person of another brand, the same as for one that does not exist', async () => {
    const token = await signIn(app, 'pizza@x.io');

    const other = await as(app, token).get(`/api/v1/users/${world.users.burgerCashier.id}`);
    const missing = await as(app, token).get('/api/v1/users/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b');

    expect(other.status).toBe(404);
    expect(other.body).toEqual(missing.body);
  });

  it('does not show a group admin to a brand manager', async () => {
    const token = await signIn(app, 'pizza@x.io');

    const res = await as(app, token).get(`/api/v1/users/${world.users.admin.id}`);

    expect(res.status).toBe(404);
  });

  it('does not show a branch manager a person at another branch', async () => {
    const token = await signIn(app, 'mall-manager@x.io');

    const res = await as(app, token).get(`/api/v1/users/${world.users.downtownCashier.id}`);

    expect(res.status).toBe(404);
  });

  it('rejects an id that is not a UUID', async () => {
    const token = await signIn(app, 'admin@x.io');

    expect((await as(app, token).get('/api/v1/users/not-a-uuid')).status).toBe(400);
  });
});
