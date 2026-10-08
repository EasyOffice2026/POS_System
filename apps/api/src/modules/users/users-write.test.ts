import { adminUserSchema } from '@pos/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { createBranch, createBrand, createUser, TEST_PASSWORD } from '../../../test/factories';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import {
  as,
  createUsersWorld,
  errorOf,
  refreshCookieOf,
  signIn,
  type UsersWorld,
} from '../../../test/users-world';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const app = createApp({ prisma, config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }) });

let world: UsersWorld;

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  world = await createUsersWorld(prisma, hasher);
});

const USERS = '/api/v1/users';
const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));
const asAdmin = async () => as(app, await signIn(app, 'admin@x.io'));
const auditActions = async () => (await prisma.auditLog.findMany()).map((row) => row.action);

function messagesOf(res: request.Response): string[] {
  return (errorOf(res).details ?? []).map((detail) => `${detail.path}:${detail.message}`);
}

describe('POST /users', () => {
  it('lets a brand manager create a cashier, who can then sign in with the PIN', async () => {
    const api = await asPizzaManager();

    const res = await api.post(USERS, {
      name: 'New Cashier',
      staffCode: '2001',
      roleKey: 'cashier',
      branchIds: [world.mall.id],
      pin: '7391',
    });

    expect(res.status).toBe(201);
    expect(adminUserSchema.parse(res.body)).toMatchObject({
      name: 'New Cashier',
      brandId: world.pizza.id,
      branchIds: [world.mall.id],
      role: { key: 'cashier', scope: 'BRANCH' },
      hasPin: true,
      hasPassword: false,
      isActive: true,
    });

    const signedIn = await request(app)
      .post('/api/v1/auth/login')
      .send({ type: 'pin', branchId: world.mall.id, staffCode: '2001', pin: '7391' });
    expect(signedIn.status).toBe(200);
  });

  it('lets a group admin create a brand manager for a chosen brand, who can sign in with the password', async () => {
    const api = await asAdmin();

    const res = await api.post(USERS, {
      name: 'Burger Boss',
      email: 'boss@x.io',
      roleKey: 'brand_manager',
      brandId: world.burger.id,
      password: 'a long enough password',
    });

    expect(res.status).toBe(201);
    expect(adminUserSchema.parse(res.body).brandId).toBe(world.burger.id);
    const signedIn = await request(app)
      .post('/api/v1/auth/login')
      .send({ type: 'password', email: 'boss@x.io', password: 'a long enough password' });
    expect(signedIn.status).toBe(200);
  });

  it('lets a group admin create another group admin, with no brand', async () => {
    const api = await asAdmin();

    const res = await api.post(USERS, {
      name: 'Second Admin',
      email: 'admin2@x.io',
      roleKey: 'group_admin',
    });

    expect(res.status).toBe(201);
    expect(adminUserSchema.parse(res.body)).toMatchObject({ brandId: null, branchIds: [] });
  });

  it('puts a brand manager’s new person in the brand manager’s own brand', async () => {
    const api = await asPizzaManager();

    const res = await api.post(USERS, {
      name: 'Kitchen Kim',
      staffCode: '2002',
      roleKey: 'kitchen',
      branchIds: [world.downtown.id],
    });

    expect(adminUserSchema.parse(res.body).brandId).toBe(world.pizza.id);
  });

  it('accepts the brand manager’s own brand when it is named', async () => {
    const api = await asPizzaManager();

    const res = await api.post(USERS, {
      name: 'Marketing Mo',
      email: 'mo@x.io',
      roleKey: 'marketing',
      brandId: world.pizza.id,
    });

    expect(res.status).toBe(201);
  });

  it('does not let a brand manager create a group admin', async () => {
    const api = await asPizzaManager();

    const res = await api.post(USERS, {
      name: 'Sneaky',
      email: 'sneaky@x.io',
      roleKey: 'group_admin',
    });

    expect(res.status).toBe(403);
    expect(await prisma.user.count({ where: { email: 'sneaky@x.io' } })).toBe(0);
  });

  it('does not let a brand manager create a person in another brand', async () => {
    const api = await asPizzaManager();

    const res = await api.post(USERS, {
      name: 'Sneaky',
      email: 'sneaky@x.io',
      roleKey: 'marketing',
      brandId: world.burger.id,
    });

    expect(res.status).toBe(403);
    expect(await prisma.user.count({ where: { email: 'sneaky@x.io' } })).toBe(0);
  });

  it('does not let a cashier or a branch manager create anybody', async () => {
    for (const email of ['cashier@x.io', 'mall-manager@x.io']) {
      const api = as(app, await signIn(app, email));

      const res = await api.post(USERS, { name: 'X', email: 'x@x.io', roleKey: 'marketing' });

      expect(res.status).toBe(403);
    }
  });

  it('needs a signed-in person', async () => {
    const res = await request(app).post(USERS).send({ name: 'X' });

    expect(res.status).toBe(401);
  });

  describe('the brand and the branches', () => {
    it('needs a brand when a group admin creates a brand-level or branch-level person', async () => {
      const res = await (
        await asAdmin()
      ).post(USERS, {
        name: 'X',
        email: 'x@x.io',
        roleKey: 'brand_manager',
      });

      expect(res.status).toBe(400);
      expect(messagesOf(res)).toContain('brandId:BRAND_REQUIRED');
    });

    it('refuses a brand that does not exist', async () => {
      const res = await (
        await asAdmin()
      ).post(USERS, {
        name: 'X',
        email: 'x@x.io',
        roleKey: 'brand_manager',
        brandId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      });

      expect(messagesOf(res)).toContain('brandId:BRAND_NOT_FOUND');
    });

    it('refuses a brand for a group admin', async () => {
      const res = await (
        await asAdmin()
      ).post(USERS, {
        name: 'X',
        email: 'x@x.io',
        roleKey: 'group_admin',
        brandId: world.pizza.id,
      });

      expect(messagesOf(res)).toContain('brandId:BRAND_NOT_ALLOWED_FOR_GROUP_ROLE');
    });

    it('needs at least one branch for a branch-level role', async () => {
      const res = await (
        await asPizzaManager()
      ).post(USERS, {
        name: 'X',
        staffCode: '3001',
        roleKey: 'cashier',
      });

      expect(res.status).toBe(400);
      expect(messagesOf(res)).toContain('branchIds:BRANCH_REQUIRED');
    });

    it('refuses a branch of another brand', async () => {
      const res = await (
        await asPizzaManager()
      ).post(USERS, {
        name: 'X',
        staffCode: '3001',
        roleKey: 'cashier',
        branchIds: [world.airport.id],
      });

      expect(messagesOf(res)).toContain('branchIds:BRANCH_NOT_FOUND');
      expect(await prisma.user.count({ where: { staffCode: '3001' } })).toBe(0);
    });

    it('refuses a branch that does not exist', async () => {
      const res = await (
        await asPizzaManager()
      ).post(USERS, {
        name: 'X',
        staffCode: '3001',
        roleKey: 'cashier',
        branchIds: [world.mall.id, '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'],
      });

      expect(messagesOf(res)).toContain('branchIds:BRANCH_NOT_FOUND');
    });

    it('refuses branches for a brand-level role', async () => {
      const res = await (
        await asPizzaManager()
      ).post(USERS, {
        name: 'X',
        email: 'x@x.io',
        roleKey: 'brand_manager',
        branchIds: [world.mall.id],
      });

      expect(messagesOf(res)).toContain('branchIds:BRANCHES_NOT_ALLOWED_FOR_ROLE');
    });

    it('counts a branch named twice once', async () => {
      const res = await (
        await asPizzaManager()
      ).post(USERS, {
        name: 'X',
        staffCode: '3001',
        roleKey: 'cashier',
        branchIds: [world.mall.id, world.mall.id],
      });

      expect(res.status).toBe(201);
      expect(adminUserSchema.parse(res.body).branchIds).toEqual([world.mall.id]);
    });
  });

  describe('email and staff code', () => {
    it('refuses an email that is already used, whatever its case', async () => {
      const res = await (
        await asPizzaManager()
      ).post(USERS, {
        name: 'X',
        email: 'PIZZA@x.io',
        roleKey: 'marketing',
      });

      expect(res.status).toBe(409);
      expect(errorOf(res).code).toBe('EMAIL_TAKEN');
    });

    it('refuses an email used in another brand, with the same answer', async () => {
      const res = await (
        await asPizzaManager()
      ).post(USERS, {
        name: 'X',
        email: 'burger@x.io',
        roleKey: 'marketing',
      });

      expect(res.status).toBe(409);
      expect(errorOf(res).code).toBe('EMAIL_TAKEN');
    });

    it('refuses a staff code that is already used in the brand', async () => {
      const res = await (
        await asPizzaManager()
      ).post(USERS, {
        name: 'X',
        staffCode: '1001',
        roleKey: 'cashier',
        branchIds: [world.mall.id],
      });

      expect(res.status).toBe(409);
      expect(errorOf(res).code).toBe('STAFF_CODE_TAKEN');
    });

    it('allows a staff code that another brand uses', async () => {
      const res = await (
        await asAdmin()
      ).post(USERS, {
        name: 'X',
        staffCode: '1002',
        roleKey: 'cashier',
        brandId: world.burger.id,
        branchIds: [world.airport.id],
      });

      expect(res.status).toBe(201);
    });

    it('refuses a staff code for a group admin, who has no brand', async () => {
      const res = await (
        await asAdmin()
      ).post(USERS, {
        name: 'X',
        email: 'x@x.io',
        staffCode: '5',
        roleKey: 'group_admin',
      });

      expect(messagesOf(res)).toContain('staffCode:STAFF_CODE_NEEDS_BRAND');
    });
  });

  describe('passwords and PINs', () => {
    it('refuses an easy PIN and says why', async () => {
      const res = await (
        await asPizzaManager()
      ).post(USERS, {
        name: 'X',
        staffCode: '3001',
        roleKey: 'cashier',
        branchIds: [world.mall.id],
        pin: '1234',
      });

      expect(res.status).toBe(400);
      expect(messagesOf(res)).toContain('pin:PIN_SEQUENCE');
    });

    it('refuses a short password and says why', async () => {
      const res = await (
        await asPizzaManager()
      ).post(USERS, {
        name: 'X',
        email: 'x@x.io',
        roleKey: 'marketing',
        password: 'short',
      });

      expect(messagesOf(res)).toContain('password:PASSWORD_TOO_SHORT');
    });

    it('needs a staff code for a PIN and an email for a password', async () => {
      const api = await asPizzaManager();

      const noCode = await api.post(USERS, {
        name: 'X',
        email: 'x@x.io',
        roleKey: 'cashier',
        branchIds: [world.mall.id],
        pin: '7391',
      });
      const noEmail = await api.post(USERS, {
        name: 'X',
        staffCode: '3001',
        roleKey: 'cashier',
        branchIds: [world.mall.id],
        password: 'a long enough password',
      });

      expect(messagesOf(noCode)).toContain('pin:PIN_NEEDS_STAFF_CODE');
      expect(messagesOf(noEmail)).toContain('password:PASSWORD_NEEDS_EMAIL');
    });

    it('refuses a PIN for a role that does not sign in with one', async () => {
      const res = await (
        await asPizzaManager()
      ).post(USERS, {
        name: 'X',
        email: 'x@x.io',
        staffCode: '3001',
        roleKey: 'brand_manager',
        pin: '7391',
      });

      expect(messagesOf(res)).toContain('pin:PIN_ONLY_FOR_BRANCH_ROLES');
    });

    it('stores only hashes, and never returns them', async () => {
      const res = await (
        await asPizzaManager()
      ).post(USERS, {
        name: 'X',
        email: 'x@x.io',
        staffCode: '3001',
        roleKey: 'cashier',
        branchIds: [world.mall.id],
        password: 'a long enough password',
        pin: '7391',
      });

      const row = await prisma.user.findUniqueOrThrow({ where: { email: 'x@x.io' } });
      expect(row.passwordHash).toMatch(/^scrypt\$/);
      expect(row.pinHash).toMatch(/^scrypt\$/);
      expect(JSON.stringify(res.body)).not.toMatch(/scrypt|a long enough password|7391/);
    });
  });

  describe('what a request may contain', () => {
    it('needs an email or a staff code', async () => {
      const res = await (await asPizzaManager()).post(USERS, { name: 'X', roleKey: 'marketing' });

      expect(messagesOf(res)).toContain('email:EMAIL_OR_STAFF_CODE_REQUIRED');
    });

    it('refuses a field it does not know', async () => {
      const res = await (
        await asPizzaManager()
      ).post(USERS, {
        name: 'X',
        email: 'x@x.io',
        roleKey: 'marketing',
        isActive: false,
        passwordHash: 'x',
      });

      expect(res.status).toBe(400);
    });

    it('refuses a role that does not exist', async () => {
      const res = await (
        await asPizzaManager()
      ).post(USERS, {
        name: 'X',
        email: 'x@x.io',
        roleKey: 'owner',
      });

      expect(res.status).toBe(400);
    });
  });

  it('writes an audit row for the person who did it', async () => {
    const res = await (
      await asPizzaManager()
    ).post(USERS, {
      name: 'Audit Me',
      staffCode: '4001',
      roleKey: 'cashier',
      branchIds: [world.mall.id],
    });

    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.created' } });
    expect(row).toMatchObject({
      userId: world.users.pizzaManager.id,
      brandId: world.pizza.id,
      entityType: 'user',
      entityId: (res.body as { id: string }).id,
    });
    expect(row.metadata).toEqual({ role: 'cashier', branches: 1 });
  });
});

describe('PATCH /users/:id', () => {
  const patch = async (id: string, body: object, as_ = asPizzaManager) =>
    (await as_()).patch(`${USERS}/${id}`, body);

  it('changes a name and records what changed', async () => {
    const res = await patch(world.users.cashier.id, { name: 'Sara Renamed' });

    expect(res.status).toBe(200);
    expect(adminUserSchema.parse(res.body).name).toBe('Sara Renamed');
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.updated' } });
    expect(row.metadata).toEqual({ changed: ['name'] });
  });

  it('does nothing, and writes nothing, when nothing really changes', async () => {
    const res = await patch(world.users.cashier.id, { name: 'Sara Cashier' });

    expect(res.status).toBe(200);
    expect(await auditActions()).not.toContain('user.updated');
  });

  it('changes the role inside the same scope and keeps the branches', async () => {
    const res = await patch(world.users.cashier.id, { roleKey: 'kitchen' });

    expect(adminUserSchema.parse(res.body)).toMatchObject({
      role: { key: 'kitchen' },
      branchIds: [world.mall.id],
    });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.updated' } });
    expect(row.metadata).toMatchObject({
      changed: ['role'],
      role: { from: 'cashier', to: 'kitchen' },
    });
  });

  it('clears the branches when somebody moves to a brand-level role', async () => {
    const res = await patch(world.users.cashier.id, { roleKey: 'marketing' });

    expect(adminUserSchema.parse(res.body)).toMatchObject({
      role: { key: 'marketing' },
      branchIds: [],
    });
    expect(await prisma.userBranch.count({ where: { userId: world.users.cashier.id } })).toBe(0);
  });

  it('needs a branch when somebody moves to a branch-level role', async () => {
    const marketing = await createUser(prisma, hasher, {
      roleKey: 'marketing',
      name: 'Mo Marketing',
      brandId: world.pizza.id,
      email: 'mo@x.io',
    });

    const refused = await patch(marketing.id, { roleKey: 'cashier' });
    expect(refused.status).toBe(400);
    expect(messagesOf(refused)).toContain('branchIds:BRANCH_REQUIRED');

    const allowed = await patch(marketing.id, {
      roleKey: 'cashier',
      branchIds: [world.downtown.id],
    });
    expect(adminUserSchema.parse(allowed.body)).toMatchObject({
      role: { key: 'cashier' },
      branchIds: [world.downtown.id],
    });
  });

  it('moves a person between branches', async () => {
    const res = await patch(world.users.cashier.id, { branchIds: [world.downtown.id] });

    expect(adminUserSchema.parse(res.body).branchIds).toEqual([world.downtown.id]);
    const rows = await prisma.userBranch.findMany({ where: { userId: world.users.cashier.id } });
    expect(rows.map((row) => row.branchId)).toEqual([world.downtown.id]);
    expect(rows[0]?.brandId).toBe(world.pizza.id);
  });

  it('adds a branch next to the one the person already has', async () => {
    const res = await patch(world.users.cashier.id, {
      branchIds: [world.mall.id, world.downtown.id],
    });

    expect(adminUserSchema.parse(res.body).branchIds.sort()).toEqual(
      [world.mall.id, world.downtown.id].sort(),
    );
  });

  it('refuses a branch of another brand', async () => {
    const res = await patch(world.users.cashier.id, { branchIds: [world.airport.id] });

    expect(messagesOf(res)).toContain('branchIds:BRANCH_NOT_FOUND');
  });

  it('changes the email and staff code, and clears them with null', async () => {
    const changed = await patch(world.users.cashier.id, { email: 'sara2@x.io', staffCode: '1009' });
    expect(adminUserSchema.parse(changed.body)).toMatchObject({
      email: 'sara2@x.io',
      staffCode: '1009',
    });

    const cleared = await patch(world.users.cashier.id, { email: null });
    expect(adminUserSchema.parse(cleared.body).email).toBeNull();
  });

  it('refuses an email or staff code that somebody else uses', async () => {
    const email = await patch(world.users.cashier.id, { email: 'burger@x.io' });
    const code = await patch(world.users.cashier.id, { staffCode: '1002' });

    expect(errorOf(email).code).toBe('EMAIL_TAKEN');
    expect(errorOf(code).code).toBe('STAFF_CODE_TAKEN');
  });

  it('lets a person keep their own email and staff code in a request', async () => {
    const res = await patch(world.users.cashier.id, { email: 'cashier@x.io', staffCode: '1001' });

    expect(res.status).toBe(200);
  });

  it('does not let a brand manager touch a person of another brand or a group admin', async () => {
    const other = await patch(world.users.burgerCashier.id, { name: 'Hacked' });
    const admin = await patch(world.users.admin.id, { name: 'Hacked' });

    expect(other.status).toBe(404);
    expect(admin.status).toBe(404);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: world.users.burgerCashier.id } })).name,
    ).toBe('Omar Burger Cashier');
  });

  it('does not let a brand manager give the group admin role', async () => {
    const res = await patch(world.users.cashier.id, { roleKey: 'group_admin' });

    expect(res.status).toBe(403);
  });

  it('does not let a cashier or a branch manager change anybody', async () => {
    for (const email of ['cashier@x.io', 'mall-manager@x.io']) {
      const res = await patch(world.users.cashier.id, { name: 'X' }, async () =>
        as(app, await signIn(app, email)),
      );

      expect(res.status).toBe(403);
    }
  });

  describe('changing yourself', () => {
    it('lets a person change their own name', async () => {
      const res = await patch(world.users.pizzaManager.id, { name: 'Amal Renamed' });

      expect(res.status).toBe(200);
    });

    it('does not let a person change their own role', async () => {
      const res = await patch(world.users.pizzaManager.id, { roleKey: 'marketing' });

      expect(res.status).toBe(403);
    });

    it('does not let a person deactivate themselves', async () => {
      const res = await patch(world.users.pizzaManager.id, { isActive: false });

      expect(res.status).toBe(403);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: world.users.pizzaManager.id } }))
          .isActive,
      ).toBe(true);
    });

    it('lets a group admin change another group admin, but not their own role', async () => {
      const second = await (
        await asAdmin()
      ).post(USERS, {
        name: 'Second Admin',
        email: 'admin2@x.io',
        roleKey: 'group_admin',
      });
      const id = (second.body as { id: string }).id;

      const changed = await patch(id, { name: 'Second Renamed' }, asAdmin);
      const ownRole = await patch(world.users.admin.id, { roleKey: 'brand_manager' }, asAdmin);

      expect(changed.status).toBe(200);
      expect(ownRole.status).toBe(403);
    });
  });

  describe('deactivating', () => {
    it('signs the person out everywhere and refuses their next sign-in', async () => {
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ type: 'password', email: 'cashier@x.io', password: TEST_PASSWORD });
      const cookie = refreshCookieOf(login) ?? '';

      const res = await patch(world.users.cashier.id, { isActive: false });

      expect(adminUserSchema.parse(res.body).isActive).toBe(false);
      const refresh = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `pos_refresh=${cookie}`);
      expect(refresh.status).toBe(401);
      const again = await request(app)
        .post('/api/v1/auth/login')
        .send({ type: 'password', email: 'cashier@x.io', password: TEST_PASSWORD });
      expect(again.status).toBe(401);
    });

    it('lets the person in again when they are activated', async () => {
      await patch(world.users.cashier.id, { isActive: false });

      await patch(world.users.cashier.id, { isActive: true });

      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ type: 'password', email: 'cashier@x.io', password: TEST_PASSWORD });
      expect(login.status).toBe(200);
    });

    it('keeps the person and their history', async () => {
      await patch(world.users.cashier.id, { isActive: false });

      expect(await prisma.user.count()).toBe(7);
      const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.updated' } });
      expect(row.metadata).toMatchObject({ changed: ['isActive'], isActive: false });
    });
  });

  describe('what a request may contain', () => {
    it('needs at least one field', async () => {
      expect((await patch(world.users.cashier.id, {})).status).toBe(400);
    });

    it('refuses fields that cannot be changed this way', async () => {
      expect((await patch(world.users.cashier.id, { brandId: world.burger.id })).status).toBe(400);
      expect((await patch(world.users.cashier.id, { pin: '7391' })).status).toBe(400);
    });

    it('rejects an id that is not a UUID', async () => {
      expect((await patch('nope', { name: 'X' })).status).toBe(400);
    });
  });
});

describe('a brand of its own', () => {
  it('keeps a new brand’s people apart from the first one', async () => {
    const third = await createBrand(prisma, 'Third');
    const branch = await createBranch(prisma, third.id, 'Third Branch');
    const api = await asAdmin();

    const res = await api.post(USERS, {
      name: 'Third Cashier',
      staffCode: '1001',
      roleKey: 'cashier',
      brandId: third.id,
      branchIds: [branch.id],
    });

    expect(res.status).toBe(201);
    expect(adminUserSchema.parse(res.body).brandId).toBe(third.id);
  });
});
