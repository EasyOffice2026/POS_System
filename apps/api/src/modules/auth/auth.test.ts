import { sessionResponseSchema } from '@pos/shared';
import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app';
import { createBranch, createBrand, createUser, TEST_PASSWORD } from '../../../test/factories';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';
import { createTokenService } from '../../lib/tokens';
import { lockSeconds } from './auth.service';

const prisma = createTestPrisma();
const config = testConfig({ AUTH_RATE_LIMIT_MAX: '1000' });
const hasher = createPasswordHasher(hashProfiles.fast);
const tokens = createTokenService(config);
const app = createApp({ prisma, config });

const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const LOGOUT = '/api/v1/auth/logout';
const ME = '/api/v1/auth/me';

interface World {
  brand: { id: string };
  branch: { id: string };
  otherBrand: { id: string };
  otherBranch: { id: string };
}

let world: World;

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await resetDatabase(prisma);
  const brand = await createBrand(prisma, 'Pizza');
  const branch = await createBranch(prisma, brand.id, 'Mall');
  const otherBrand = await createBrand(prisma, 'Burger');
  const otherBranch = await createBranch(prisma, otherBrand.id, 'Airport');
  world = { brand, branch, otherBrand, otherBranch };

  await createUser(prisma, hasher, { roleKey: 'group_admin', email: 'admin@pos.local' });
  await createUser(prisma, hasher, {
    roleKey: 'brand_manager',
    brandId: brand.id,
    email: 'manager@pos.local',
  });
  await createUser(prisma, hasher, {
    roleKey: 'cashier',
    brandId: brand.id,
    branchIds: [branch.id],
    staffCode: '1001',
    pin: '1234',
  });
  await createUser(prisma, hasher, {
    roleKey: 'cashier',
    brandId: otherBrand.id,
    branchIds: [otherBranch.id],
    staffCode: '1001',
    pin: '9999',
  });
});

const passwordLogin = (email: string, password = TEST_PASSWORD) =>
  request(app).post(LOGIN).send({ type: 'password', email, password });

const pinLogin = (branchId: string, staffCode: string, pin: string) =>
  request(app).post(LOGIN).send({ type: 'pin', branchId, staffCode, pin });

function refreshTokenOf(res: request.Response): string | undefined {
  const raw: unknown = res.headers['set-cookie'];
  const lines = Array.isArray(raw) ? raw.map(String) : [];
  const line = lines.find((entry) => entry.startsWith('pos_refresh='));
  const value = line?.split(';')[0]?.slice('pos_refresh='.length);
  return value || undefined;
}

const refreshWith = (token: string) =>
  request(app).post(REFRESH).set('Cookie', `pos_refresh=${token}`);

describe('POST /auth/login with a password', () => {
  it('returns a session, and sets the refresh token as a locked-down cookie', async () => {
    const res = await passwordLogin('admin@pos.local');

    expect(res.status).toBe(200);
    const session = sessionResponseSchema.parse(res.body);
    expect(session.expiresIn).toBe(900);
    expect(session.user).toMatchObject({
      email: 'admin@pos.local',
      scope: 'GROUP',
      brandId: null,
      branchIds: [],
      role: { key: 'group_admin', name: 'Group Admin' },
    });

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('pos_refresh='),
    );
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).toMatch(/Expires=/);
    expect(refreshTokenOf(res)).toBeTruthy();
  });

  it('puts the person, role and permissions in the access token', async () => {
    const res = await passwordLogin('manager@pos.local');

    const claims = await tokens.verifyAccessToken(
      (res.body as { accessToken: string }).accessToken,
    );

    expect(claims).toMatchObject({
      role: 'brand_manager',
      scope: 'BRAND',
      brandId: world.brand.id,
      branchIds: [],
    });
    expect(claims.permissions).toContain('branches:write');
    expect(claims.permissions).not.toContain('brands:write');
  });

  it('ignores case and spaces around the email', async () => {
    const res = await passwordLogin('  ADMIN@Pos.Local ');

    expect(res.status).toBe(200);
  });

  it('answers a wrong password and an unknown email the same way', async () => {
    const wrongPassword = await passwordLogin('admin@pos.local', 'nope');
    const unknownEmail = await passwordLogin('nobody@pos.local', 'nope');

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
    expect((wrongPassword.body as { error: { code: string } }).error.code).toBe(
      'INVALID_CREDENTIALS',
    );
    expect(refreshTokenOf(wrongPassword)).toBeUndefined();
  });

  it('refuses an inactive account', async () => {
    await prisma.user.update({ where: { email: 'admin@pos.local' }, data: { isActive: false } });

    const res = await passwordLogin('admin@pos.local');

    expect(res.status).toBe(401);
  });

  it('rejects a body that is not a login request', async () => {
    const res = await request(app).post(LOGIN).send({ type: 'password', email: 'not-an-email' });

    expect(res.status).toBe(400);
    const body = res.body as { error: { code: string; details: { path: string }[] } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.map((d) => d.path)).toContain('email');
  });

  it('rejects a body that is not JSON', async () => {
    const res = await request(app)
      .post(LOGIN)
      .set('Content-Type', 'application/json')
      .send('{"type": "password",');

    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('INVALID_JSON');
  });
});

describe('POST /auth/login with a staff code and PIN', () => {
  it('limits the session to the terminal branch', async () => {
    const res = await pinLogin(world.branch.id, '1001', '1234');

    expect(res.status).toBe(200);
    const claims = await tokens.verifyAccessToken(
      (res.body as { accessToken: string }).accessToken,
    );
    expect(claims).toMatchObject({
      role: 'cashier',
      scope: 'BRANCH',
      brandId: world.brand.id,
      branchIds: [world.branch.id],
    });
  });

  it('finds the right person when two brands use the same staff code', async () => {
    const res = await pinLogin(world.otherBranch.id, '1001', '9999');

    expect(res.status).toBe(200);
    expect((res.body as { user: { brandId: string } }).user.brandId).toBe(world.otherBrand.id);
  });

  it('refuses the PIN of a person from another brand', async () => {
    const res = await pinLogin(world.branch.id, '1001', '9999');

    expect(res.status).toBe(401);
  });

  it('refuses a staff member who is not assigned to that branch', async () => {
    const otherBranchSameBrand = await createBranch(prisma, world.brand.id, 'Downtown');

    const res = await pinLogin(otherBranchSameBrand.id, '1001', '1234');

    expect(res.status).toBe(401);
  });

  it('refuses an unknown branch, an unknown staff code and a wrong PIN the same way', async () => {
    const unknownBranch = await pinLogin('0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', '1001', '1234');
    const unknownCode = await pinLogin(world.branch.id, '9999', '1234');
    const wrongPin = await pinLogin(world.branch.id, '1001', '0000');

    for (const res of [unknownBranch, unknownCode, wrongPin]) {
      expect(res.status).toBe(401);
      expect((res.body as { error: { code: string } }).error.code).toBe('INVALID_CREDENTIALS');
    }
  });

  it('is only for branch-scoped roles', async () => {
    await createUser(prisma, hasher, {
      roleKey: 'brand_manager',
      brandId: world.brand.id,
      branchIds: [world.branch.id],
      staffCode: '5000',
      pin: '5555',
    });

    const res = await pinLogin(world.branch.id, '5000', '5555');

    expect(res.status).toBe(401);
  });

  it('refuses a PIN of the wrong shape before looking anything up', async () => {
    const res = await pinLogin(world.branch.id, '1001', '12');

    expect(res.status).toBe(400);
  });

  it('does not accept a PIN for the password login or the reverse', async () => {
    const asPassword = await passwordLogin('admin@pos.local', '1234');

    expect(asPassword.status).toBe(401);
  });
});

describe('a branch or brand that is not active', () => {
  const deactivateBranch = (id = world.branch.id) =>
    prisma.branch.update({ where: { id }, data: { isActive: false } });
  const deactivateBrand = (id = world.brand.id) =>
    prisma.brand.update({ where: { id }, data: { isActive: false } });
  const codeOf = (res: request.Response) => (res.body as { error: { code: string } }).error.code;

  it('tells a terminal at an inactive branch, so it can show a message', async () => {
    await deactivateBranch();

    const res = await pinLogin(world.branch.id, '1001', '1234');

    expect(res.status).toBe(403);
    expect(codeOf(res)).toBe('BRANCH_INACTIVE');
    expect(refreshTokenOf(res)).toBeUndefined();
  });

  it('tells a terminal at a branch of an inactive brand', async () => {
    await deactivateBrand();

    const res = await pinLogin(world.branch.id, '1001', '1234');

    expect(res.status).toBe(403);
    expect(codeOf(res)).toBe('BRANCH_INACTIVE');
  });

  it('answers before the PIN is looked at, so nobody collects failed attempts', async () => {
    await deactivateBranch();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      expect(codeOf(await pinLogin(world.branch.id, '1001', '0000'))).toBe('BRANCH_INACTIVE');
    }

    const cashier = await prisma.user.findFirstOrThrow({
      where: { brandId: world.brand.id, staffCode: '1001' },
    });
    expect(cashier.failedLoginAttempts).toBe(0);
    expect(cashier.lockedUntil).toBeNull();
  });

  it('lets staff sign in again when the branch is activated', async () => {
    await deactivateBranch();
    await pinLogin(world.branch.id, '1001', '1234');
    await prisma.branch.update({ where: { id: world.branch.id }, data: { isActive: true } });

    const res = await pinLogin(world.branch.id, '1001', '1234');

    expect(res.status).toBe(200);
  });

  it('still answers an unknown branch like a wrong PIN, so only a real branch is told apart', async () => {
    const res = await pinLogin('0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', '1001', '1234');

    expect(res.status).toBe(401);
    expect(codeOf(res)).toBe('INVALID_CREDENTIALS');
  });

  it('records the attempt in the audit log, for the managers of that brand', async () => {
    await deactivateBranch();

    await pinLogin(world.branch.id, '1001', '1234');

    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'auth.login.failed' } });
    expect(row).toMatchObject({
      brandId: world.brand.id,
      branchId: world.branch.id,
      userId: null,
    });
    expect(row.metadata).toEqual({
      type: 'pin',
      branchId: world.branch.id,
      staffCode: '1001',
      reason: 'branch_inactive',
    });
  });

  it('leaves the other branches of the brand working', async () => {
    const downtown = await createBranch(prisma, world.brand.id, 'Downtown');
    const cashier = await prisma.user.findFirstOrThrow({
      where: { brandId: world.brand.id, staffCode: '1001' },
    });
    await prisma.userBranch.create({
      data: { userId: cashier.id, branchId: downtown.id, brandId: world.brand.id },
    });
    await deactivateBranch();

    const res = await pinLogin(downtown.id, '1001', '1234');

    expect(res.status).toBe(200);
  });

  it('does not stop a person who signs in with a password, so a manager can reach an inactive brand', async () => {
    await deactivateBrand();

    const login = await passwordLogin('manager@pos.local');
    const refreshed = await refreshWith(refreshTokenOf(login) ?? '');

    expect(login.status).toBe(200);
    expect(refreshed.status).toBe(200);
  });

  it('ends a PIN session at its next refresh when the branch is deactivated', async () => {
    const login = await pinLogin(world.branch.id, '1001', '1234');
    await deactivateBranch();

    const res = await refreshWith(refreshTokenOf(login) ?? '');

    expect(res.status).toBe(401);
    expect(codeOf(res)).toBe('INVALID_REFRESH_TOKEN');
  });

  it('ends a PIN session at its next refresh when the brand is deactivated', async () => {
    const login = await pinLogin(world.branch.id, '1001', '1234');
    await deactivateBrand();

    const res = await refreshWith(refreshTokenOf(login) ?? '');

    expect(res.status).toBe(401);
  });

  it('keeps that session over after the branch is activated again', async () => {
    const login = await pinLogin(world.branch.id, '1001', '1234');
    await deactivateBranch();
    await refreshWith(refreshTokenOf(login) ?? '');
    await prisma.branch.update({ where: { id: world.branch.id }, data: { isActive: true } });

    const res = await refreshWith(refreshTokenOf(login) ?? '');

    expect(res.status).toBe(401);
  });

  it('lets a PIN session at another branch go on when a different branch is deactivated', async () => {
    const downtown = await createBranch(prisma, world.brand.id, 'Downtown');
    const cashier = await prisma.user.findFirstOrThrow({
      where: { brandId: world.brand.id, staffCode: '1001' },
    });
    await prisma.userBranch.create({
      data: { userId: cashier.id, branchId: downtown.id, brandId: world.brand.id },
    });
    const login = await pinLogin(world.branch.id, '1001', '1234');
    await deactivateBranch(downtown.id);

    const res = await refreshWith(refreshTokenOf(login) ?? '');

    expect(res.status).toBe(200);
  });
});

describe('timing of failed sign-ins', () => {
  it('checks a dummy hash for an unknown account, and a real one for a known account', async () => {
    const real = createPasswordHasher(hashProfiles.fast);
    const spy = {
      hash: (secret: string) => real.hash(secret),
      verify: vi.fn((secret: string, stored: string) => real.verify(secret, stored)),
      verifyDummy: vi.fn((secret: string) => real.verifyDummy(secret)),
    };
    const spiedApp = createApp({ prisma, config, hasher: spy });

    await request(spiedApp)
      .post(LOGIN)
      .send({ type: 'password', email: 'nobody@pos.local', password: 'x' });
    expect(spy.verifyDummy).toHaveBeenCalledTimes(1);
    expect(spy.verify).not.toHaveBeenCalled();

    await request(spiedApp)
      .post(LOGIN)
      .send({ type: 'password', email: 'admin@pos.local', password: 'wrong' });
    expect(spy.verify).toHaveBeenCalledTimes(1);
    expect(spy.verifyDummy).toHaveBeenCalledTimes(1);
  });
});

describe('lockout', () => {
  async function failFiveTimes() {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await pinLogin(world.branch.id, '1001', '0000');
      expect(res.status).toBe(401);
    }
  }

  it('locks the account after five wrong PINs, even for the right PIN', async () => {
    await failFiveTimes();

    const res = await pinLogin(world.branch.id, '1001', '1234');

    expect(res.status).toBe(429);
    const body = res.body as { error: { code: string; details: { retryAfterSeconds: number } } };
    expect(body.error.code).toBe('ACCOUNT_LOCKED');
    expect(body.error.details.retryAfterSeconds).toBeGreaterThan(890);
    expect(body.error.details.retryAfterSeconds).toBeLessThanOrEqual(900);
    expect(Number(res.headers['retry-after'])).toBe(body.error.details.retryAfterSeconds);
  });

  it('does not count attempts while the account is locked', async () => {
    await failFiveTimes();
    await pinLogin(world.branch.id, '1001', '0000');
    await pinLogin(world.branch.id, '1001', '0000');

    const user = await prisma.user.findFirstOrThrow({
      where: { brandId: world.brand.id, staffCode: '1001' },
    });
    expect(user.failedLoginAttempts).toBe(5);
  });

  it('lets the person in again when the lock has run out, and resets the count', async () => {
    await failFiveTimes();
    await prisma.user.updateMany({
      where: { staffCode: '1001', brandId: world.brand.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });

    const res = await pinLogin(world.branch.id, '1001', '1234');

    expect(res.status).toBe(200);
    const user = await prisma.user.findFirstOrThrow({
      where: { brandId: world.brand.id, staffCode: '1001' },
    });
    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lockedUntil).toBeNull();
    expect(user.lastLoginAt).not.toBeNull();
  });

  it('locks for twice as long on the next five failures', async () => {
    await prisma.user.updateMany({
      where: { staffCode: '1001', brandId: world.brand.id },
      data: { failedLoginAttempts: 9 },
    });

    await pinLogin(world.branch.id, '1001', '0000');

    const user = await prisma.user.findFirstOrThrow({
      where: { brandId: world.brand.id, staffCode: '1001' },
    });
    const seconds = ((user.lockedUntil?.getTime() ?? 0) - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(1790);
    expect(seconds).toBeLessThanOrEqual(1800);
  });

  it('a good sign-in before the limit resets the count', async () => {
    await pinLogin(world.branch.id, '1001', '0000');
    await pinLogin(world.branch.id, '1001', '0000');

    await pinLogin(world.branch.id, '1001', '1234');

    const user = await prisma.user.findFirstOrThrow({
      where: { brandId: world.brand.id, staffCode: '1001' },
    });
    expect(user.failedLoginAttempts).toBe(0);
  });

  it('does not lock an account that does not exist, and other accounts are not affected', async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const res = await passwordLogin('nobody@pos.local', 'x');
      expect(res.status).toBe(401);
    }

    expect((await passwordLogin('admin@pos.local')).status).toBe(200);
  });

  it('doubles the lock each time, up to 24 hours', () => {
    expect(lockSeconds(5)).toBe(15 * 60);
    expect(lockSeconds(10)).toBe(30 * 60);
    expect(lockSeconds(15)).toBe(60 * 60);
    expect(lockSeconds(20)).toBe(2 * 60 * 60);
    expect(lockSeconds(40)).toBe(24 * 60 * 60);
    expect(lockSeconds(100)).toBe(24 * 60 * 60);
  });
});

describe('rate limit', () => {
  it('blocks an IP address after too many failed requests', async () => {
    const limited = createApp({ prisma, config: testConfig({ AUTH_RATE_LIMIT_MAX: '3' }) });
    const attempt = () =>
      request(limited)
        .post(LOGIN)
        .send({ type: 'password', email: 'nobody@pos.local', password: 'x' });

    for (let count = 0; count < 3; count += 1) {
      expect((await attempt()).status).toBe(401);
    }
    const blocked = await attempt();

    expect(blocked.status).toBe(429);
    expect((blocked.body as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
  });

  it('does not count requests that succeed', async () => {
    const limited = createApp({ prisma, config: testConfig({ AUTH_RATE_LIMIT_MAX: '2' }) });

    for (let count = 0; count < 5; count += 1) {
      const res = await request(limited)
        .post(LOGIN)
        .send({ type: 'password', email: 'admin@pos.local', password: TEST_PASSWORD });
      expect(res.status).toBe(200);
    }
  });
});

describe('POST /auth/refresh', () => {
  it('issues a new access token and a new refresh token', async () => {
    const first = await passwordLogin('manager@pos.local');
    const firstToken = refreshTokenOf(first);

    const res = await refreshWith(firstToken ?? '');

    expect(res.status).toBe(200);
    expect(sessionResponseSchema.safeParse(res.body).success).toBe(true);
    const secondToken = refreshTokenOf(res);
    expect(secondToken).toBeTruthy();
    expect(secondToken).not.toBe(firstToken);
  });

  it('does not store the token itself, only a hash', async () => {
    const res = await passwordLogin('manager@pos.local');
    const token = refreshTokenOf(res) ?? '';

    const stored = await prisma.refreshToken.findMany();

    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).not.toContain(token);
    expect(stored[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ends the whole session when an old token is used again', async () => {
    const first = await passwordLogin('manager@pos.local');
    const firstToken = refreshTokenOf(first) ?? '';
    const second = await refreshWith(firstToken);
    const secondToken = refreshTokenOf(second) ?? '';

    const reuse = await refreshWith(firstToken);

    expect(reuse.status).toBe(401);
    expect((reuse.body as { error: { code: string } }).error.code).toBe('INVALID_REFRESH_TOKEN');
    // The newer token from the same session stops working too.
    expect((await refreshWith(secondToken)).status).toBe(401);

    const actions = (await prisma.auditLog.findMany()).map((row) => row.action);
    expect(actions).toContain('auth.refresh.reuse_detected');
  });

  it('lets only one of two simultaneous refreshes through', async () => {
    const first = await passwordLogin('manager@pos.local');
    const token = refreshTokenOf(first) ?? '';

    const results = await Promise.all([refreshWith(token), refreshWith(token)]);

    expect(results.map((res) => res.status).sort()).toEqual([200, 401]);
  });

  it('refuses a missing, unknown or expired token', async () => {
    expect((await request(app).post(REFRESH)).status).toBe(401);
    expect((await refreshWith('not-a-real-token')).status).toBe(401);

    const first = await passwordLogin('manager@pos.local');
    await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await refreshWith(refreshTokenOf(first) ?? '')).status).toBe(401);
  });

  it('ends a PIN session a day after it began, however often it refreshes', async () => {
    const day = 24 * 60 * 60 * 1000;
    const started = Date.now();
    const first = await pinLogin(world.branch.id, '1001', '1234');
    const [firstRow] = await prisma.refreshToken.findMany();
    expect(firstRow?.expiresAt.getTime()).toBeGreaterThan(started + day - 60_000);
    expect(firstRow?.expiresAt.getTime()).toBeLessThan(started + day + 60_000);

    expect((await refreshWith(refreshTokenOf(first) ?? '')).status).toBe(200);
    const rows = await prisma.refreshToken.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows[1]?.expiresAt.getTime()).toBe(firstRow?.expiresAt.getTime());

    // A password session in the back office is extended at every refresh instead.
    const manager = await passwordLogin('manager@pos.local');
    const [before] = await prisma.refreshToken.findMany({ where: { branchId: null } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await refreshWith(refreshTokenOf(manager) ?? '');
    const after = await prisma.refreshToken.findMany({
      where: { branchId: null },
      orderBy: { createdAt: 'asc' },
    });
    expect(after[1]?.expiresAt.getTime()).toBeGreaterThan(before?.expiresAt.getTime() ?? 0);
  });

  it('clears the cookie when it refuses', async () => {
    const res = await refreshWith('not-a-real-token');

    const cleared = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('pos_refresh=;'),
    );
    expect(cleared).toBeTruthy();
  });

  it('refuses a person who was deactivated after signing in', async () => {
    const first = await passwordLogin('manager@pos.local');
    await prisma.user.update({ where: { email: 'manager@pos.local' }, data: { isActive: false } });

    const res = await refreshWith(refreshTokenOf(first) ?? '');

    expect(res.status).toBe(401);
  });

  it('rebuilds the claims from the database, so a role change takes effect', async () => {
    const first = await passwordLogin('manager@pos.local');
    const marketing = await prisma.role.findUniqueOrThrow({ where: { key: 'marketing' } });
    await prisma.user.update({
      where: { email: 'manager@pos.local' },
      data: { roleId: marketing.id },
    });

    const res = await refreshWith(refreshTokenOf(first) ?? '');

    const claims = await tokens.verifyAccessToken(
      (res.body as { accessToken: string }).accessToken,
    );
    expect(claims.role).toBe('marketing');
  });

  it('keeps a PIN session limited to its branch', async () => {
    const second = await createBranch(prisma, world.brand.id, 'Downtown');
    const cashier = await prisma.user.findFirstOrThrow({
      where: { brandId: world.brand.id, staffCode: '1001' },
    });
    await prisma.userBranch.create({
      data: { userId: cashier.id, branchId: second.id, brandId: world.brand.id },
    });

    const login = await pinLogin(world.branch.id, '1001', '1234');
    const res = await refreshWith(refreshTokenOf(login) ?? '');

    const claims = await tokens.verifyAccessToken(
      (res.body as { accessToken: string }).accessToken,
    );
    expect(claims.branchIds).toEqual([world.branch.id]);
  });
});

describe('POST /auth/logout', () => {
  it('ends the session and clears the cookie', async () => {
    const login = await passwordLogin('manager@pos.local');
    const token = refreshTokenOf(login) ?? '';

    const res = await request(app).post(LOGOUT).set('Cookie', `pos_refresh=${token}`);

    expect(res.status).toBe(204);
    expect((await refreshWith(token)).status).toBe(401);
    const actions = (await prisma.auditLog.findMany()).map((row) => row.action);
    expect(actions).toContain('auth.logout');
  });

  it('is fine without a session', async () => {
    expect((await request(app).post(LOGOUT)).status).toBe(204);
  });
});

describe('GET /auth/me', () => {
  const me = (token: string) => request(app).get(ME).set('Authorization', `Bearer ${token}`);

  it('returns the signed-in person', async () => {
    const login = await passwordLogin('manager@pos.local');
    const token = (login.body as { accessToken: string }).accessToken;

    const res = await me(token);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: 'manager@pos.local', scope: 'BRAND' });
  });

  it('needs a token', async () => {
    const res = await request(app).get(ME);

    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses a token that is not a bearer token', async () => {
    const login = await passwordLogin('manager@pos.local');
    const token = (login.body as { accessToken: string }).accessToken;

    const res = await request(app).get(ME).set('Authorization', `Basic ${token}`);

    expect(res.status).toBe(401);
  });

  it('refuses a changed token, a token signed with another secret and an unsigned token', async () => {
    const login = await passwordLogin('manager@pos.local');
    const token = (login.body as { accessToken: string }).accessToken;
    const [header, payload, signature] = token.split('.');
    const changed = `${header}.${payload}.${(signature ?? '').slice(0, -2)}xx`;
    const claims = await tokens.verifyAccessToken(token);

    const foreign = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('pos-api')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('another-secret-another-secret-another-secret'));
    const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${payload}.`;

    for (const bad of [changed, foreign, unsigned]) {
      const res = await me(bad);
      expect(res.status).toBe(401);
      expect((res.body as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('says when a token has expired, so the app knows to refresh', async () => {
    const login = await passwordLogin('manager@pos.local');
    const claims = await tokens.verifyAccessToken(
      (login.body as { accessToken: string }).accessToken,
    );
    const expired = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('pos-api')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(config.accessToken.secret));

    const res = await me(expired);

    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error.code).toBe('TOKEN_EXPIRED');
  });

  it('refuses a token of a person who was deactivated', async () => {
    const login = await passwordLogin('manager@pos.local');
    const token = (login.body as { accessToken: string }).accessToken;
    await prisma.user.update({ where: { email: 'manager@pos.local' }, data: { isActive: false } });

    expect((await me(token)).status).toBe(401);
  });
});

describe('audit log', () => {
  it('records successful and failed sign-ins with the address and browser', async () => {
    await request(app)
      .post(LOGIN)
      .set('User-Agent', 'TestBrowser/1.0')
      .send({ type: 'password', email: 'admin@pos.local', password: 'wrong' });
    await passwordLogin('admin@pos.local');

    const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });

    expect(rows.map((row) => row.action)).toEqual(['auth.login.failed', 'auth.login.success']);
    expect(rows[0]?.userAgent).toBe('TestBrowser/1.0');
    expect(rows[0]?.ip).toBeTruthy();
    expect(rows[0]?.userId).toBeTruthy();
  });

  it('records a failed sign-in for an unknown email without a user', async () => {
    await passwordLogin('nobody@pos.local', 'x');

    const row = await prisma.auditLog.findFirstOrThrow();

    expect(row.action).toBe('auth.login.failed');
    expect(row.userId).toBeNull();
    expect(row.metadata).toMatchObject({ type: 'password', email: 'nobody@pos.local' });
  });

  it('never stores a password or PIN', async () => {
    await passwordLogin('admin@pos.local', 'super-secret-password');
    await pinLogin(world.branch.id, '1001', '4242');

    const text = JSON.stringify(await prisma.auditLog.findMany());

    expect(text).not.toContain('super-secret-password');
    expect(text).not.toContain('4242');
  });

  it('records the lock when the fifth failure happens, and the attempts it blocks', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await pinLogin(world.branch.id, '1001', '0000');
    }
    await pinLogin(world.branch.id, '1001', '1234');

    const actions = (await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map(
      (row) => row.action,
    );

    expect(actions.filter((action) => action === 'auth.login.failed')).toHaveLength(5);
    expect(actions).toContain('auth.login.locked');
    expect(actions).toContain('auth.login.blocked');
  });
});
