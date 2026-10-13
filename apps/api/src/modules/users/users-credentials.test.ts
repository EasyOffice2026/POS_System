import { adminUserSchema, credentialsResultSchema, passwordProblem, pinProblem } from '@pos/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { TEST_PASSWORD } from '../../../test/factories';
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

const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));
const credentialsPath = (id: string) => `/api/v1/users/${id}/credentials`;
const unlockPath = (id: string) => `/api/v1/users/${id}/unlock`;

const pinLogin = (staffCode: string, pin: string, branchId = world.mall.id) =>
  request(app).post('/api/v1/auth/login').send({ type: 'pin', branchId, staffCode, pin });
const passwordLogin = (email: string, password: string) =>
  request(app).post('/api/v1/auth/login').send({ type: 'password', email, password });

describe('POST /users/:id/credentials', () => {
  it('sets a PIN that is given, and the old one stops working', async () => {
    const api = await asPizzaManager();

    const res = await api.post(credentialsPath(world.users.cashier.id), {
      type: 'pin',
      value: '7391',
    });

    expect(res.status).toBe(200);
    expect(credentialsResultSchema.parse(res.body)).toEqual({ type: 'pin', generatedValue: null });
    expect((await pinLogin('1001', '7391')).status).toBe(200);
    expect((await pinLogin('1001', '4829')).status).toBe(401);
  });

  it('makes a PIN when none is given, and returns it once', async () => {
    const api = await asPizzaManager();

    const res = await api.post(credentialsPath(world.users.cashier.id), { type: 'pin' });

    const { generatedValue } = credentialsResultSchema.parse(res.body);
    expect(generatedValue).toMatch(/^\d{6}$/);
    expect(pinProblem(generatedValue ?? '')).toBeNull();
    expect((await pinLogin('1001', generatedValue ?? '')).status).toBe(200);
  });

  it('makes a password when none is given', async () => {
    const api = await asPizzaManager();

    const res = await api.post(credentialsPath(world.users.cashier.id), { type: 'password' });

    const { generatedValue } = credentialsResultSchema.parse(res.body);
    expect(passwordProblem(generatedValue ?? '')).toBeNull();
    expect((await passwordLogin('cashier@x.io', generatedValue ?? '')).status).toBe(200);
    expect((await passwordLogin('cashier@x.io', TEST_PASSWORD)).status).toBe(401);
  });

  it('sets a password that is given', async () => {
    const api = await asPizzaManager();

    await api.post(credentialsPath(world.users.cashier.id), {
      type: 'password',
      value: 'a brand new password',
    });

    expect((await passwordLogin('cashier@x.io', 'a brand new password')).status).toBe(200);
  });

  it('refuses an easy PIN and a short password, and says why', async () => {
    const api = await asPizzaManager();

    const pin = await api.post(credentialsPath(world.users.cashier.id), {
      type: 'pin',
      value: '1234',
    });
    const password = await api.post(credentialsPath(world.users.cashier.id), {
      type: 'password',
      value: 'short',
    });

    expect(errorOf(pin).details).toEqual([{ path: 'value', message: 'PIN_SEQUENCE' }]);
    expect(errorOf(password).details).toEqual([{ path: 'value', message: 'PASSWORD_TOO_SHORT' }]);
  });

  it('needs a staff code for a PIN and an email for a password', async () => {
    const api = await asPizzaManager();

    const pin = await api.post(credentialsPath(world.users.pizzaManager.id), { type: 'pin' });
    const password = await api.post(credentialsPath(world.users.downtownCashier.id), {
      type: 'password',
    });

    expect(errorOf(pin).details).toEqual([{ path: 'type', message: 'PIN_NEEDS_STAFF_CODE' }]);
    expect(errorOf(password).details).toEqual([{ path: 'type', message: 'PASSWORD_NEEDS_EMAIL' }]);
  });

  it('refuses a PIN for a role that does not sign in with one', async () => {
    await prisma.user.update({
      where: { id: world.users.pizzaManager.id },
      data: { staffCode: '9' },
    });
    const api = await asPizzaManager();

    const res = await api.post(credentialsPath(world.users.pizzaManager.id), { type: 'pin' });

    expect(errorOf(res).details).toEqual([{ path: 'type', message: 'PIN_ONLY_FOR_BRANCH_ROLES' }]);
  });

  it('ends the person’s sessions, in case somebody else had them', async () => {
    const login = await passwordLogin('cashier@x.io', TEST_PASSWORD);
    const cookie = refreshCookieOf(login) ?? '';
    const api = await asPizzaManager();

    await api.post(credentialsPath(world.users.cashier.id), { type: 'password' });

    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `pos_refresh=${cookie}`);
    expect(refresh.status).toBe(401);
  });

  it('does not keep the value anywhere readable: not in the audit log, not in the answer to others', async () => {
    const api = await asPizzaManager();

    await api.post(credentialsPath(world.users.cashier.id), { type: 'pin', value: '7391' });
    const generated = await api.post(credentialsPath(world.users.downtownCashier.id), {
      type: 'pin',
    });

    const log = JSON.stringify(await prisma.auditLog.findMany());
    expect(log).not.toContain('7391');
    expect(log).not.toContain((generated.body as { generatedValue: string }).generatedValue);
    const rows = await prisma.auditLog.findMany({ where: { action: 'user.credentials_reset' } });
    expect(rows.map((row) => row.metadata)).toEqual(
      expect.arrayContaining([
        { type: 'pin', generated: false },
        { type: 'pin', generated: true },
      ]),
    );
    expect(rows.every((row) => row.userId === world.users.pizzaManager.id)).toBe(true);
  });

  it('does not let a brand manager reach a person of another brand', async () => {
    const api = await asPizzaManager();

    const res = await api.post(credentialsPath(world.users.burgerCashier.id), { type: 'pin' });

    expect(res.status).toBe(404);
    expect((await pinLogin('1001', '3817', world.airport.id)).status).toBe(200);
  });

  it('does not let a cashier or a branch manager set anything', async () => {
    for (const email of ['cashier@x.io', 'mall-manager@x.io']) {
      const api = as(app, await signIn(app, email));

      const res = await api.post(credentialsPath(world.users.cashier.id), { type: 'pin' });

      expect(res.status).toBe(403);
    }
  });

  it('refuses a request with an unknown field or type', async () => {
    const api = await asPizzaManager();

    expect(
      (await api.post(credentialsPath(world.users.cashier.id), { type: 'token' })).status,
    ).toBe(400);
    expect(
      (await api.post(credentialsPath(world.users.cashier.id), { type: 'pin', extra: 1 })).status,
    ).toBe(400);
  });

  it('lets a person set their own password', async () => {
    const api = await asPizzaManager();

    const res = await api.post(credentialsPath(world.users.pizzaManager.id), {
      type: 'password',
      value: 'my own new password',
    });

    expect(res.status).toBe(200);
    expect((await passwordLogin('pizza@x.io', 'my own new password')).status).toBe(200);
  });
});

describe('POST /users/:id/unlock', () => {
  async function lockCashier() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await pinLogin('1001', '0000');
    }
    expect((await pinLogin('1001', '4829')).status).toBe(429);
  }

  it('lets a locked person sign in again straight away', async () => {
    await lockCashier();
    const api = await asPizzaManager();

    const res = await api.post(unlockPath(world.users.cashier.id));

    expect(res.status).toBe(200);
    expect(adminUserSchema.parse(res.body).lockedUntil).toBeNull();
    expect((await pinLogin('1001', '4829')).status).toBe(200);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.unlocked' } });
    expect(row).toMatchObject({
      userId: world.users.pizzaManager.id,
      entityId: world.users.cashier.id,
      brandId: world.pizza.id,
    });
  });

  it('starts the count of failed attempts again', async () => {
    await lockCashier();
    const api = await asPizzaManager();

    await api.post(unlockPath(world.users.cashier.id));

    const row = await prisma.user.findUniqueOrThrow({ where: { id: world.users.cashier.id } });
    expect(row.failedLoginAttempts).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });

  it('is fine for a person who is not locked', async () => {
    const api = await asPizzaManager();

    const res = await api.post(unlockPath(world.users.cashier.id));

    expect(res.status).toBe(200);
  });

  it('does not let a brand manager unlock a person of another brand', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await pinLogin('1001', '0000', world.airport.id);
    }
    const api = await asPizzaManager();

    const res = await api.post(unlockPath(world.users.burgerCashier.id));

    expect(res.status).toBe(404);
    expect((await pinLogin('1001', '3817', world.airport.id)).status).toBe(429);
  });

  it('does not let a branch manager unlock anybody', async () => {
    await lockCashier();
    const api = as(app, await signIn(app, 'mall-manager@x.io'));

    const res = await api.post(unlockPath(world.users.cashier.id));

    expect(res.status).toBe(403);
  });
});
