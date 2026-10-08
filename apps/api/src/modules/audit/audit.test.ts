import { auditLogSchema, pageSchema } from '@pos/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { as, createUsersWorld, signIn, type UsersWorld } from '../../../test/users-world';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const app = createApp({ prisma, config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }) });
const auditPage = pageSchema(auditLogSchema);

let world: UsersWorld;

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  world = await createUsersWorld(prisma, hasher);
});

// Writes events directly, oldest first, so the order is known.
async function addEvents() {
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 12, minutes));
  await prisma.auditLog.createMany({
    data: [
      {
        action: 'user.created',
        brandId: world.pizza.id,
        userId: world.users.pizzaManager.id,
        createdAt: at(1),
      },
      {
        action: 'user.updated',
        brandId: world.pizza.id,
        userId: world.users.pizzaManager.id,
        branchId: world.mall.id,
        createdAt: at(2),
      },
      {
        action: 'user.created',
        brandId: world.burger.id,
        userId: world.users.burgerManager.id,
        createdAt: at(3),
      },
      {
        action: 'auth.login.failed',
        brandId: null,
        userId: null,
        metadata: { email: 'x@y.z' },
        createdAt: at(4),
      },
      {
        action: 'user.unlocked',
        brandId: world.pizza.id,
        userId: world.users.admin.id,
        createdAt: at(5),
      },
    ],
  });
}

async function logAs(email: string, query = '') {
  return as(app, await signIn(app, email)).get(`/api/v1/audit-logs${query}`);
}

const actionsOf = (res: { body: unknown }) =>
  auditPage.parse(res.body).data.map((row) => row.action);

describe('GET /audit-logs: who sees what', () => {
  beforeEach(addEvents);

  it('shows a group admin every event, newest first, including those of no brand', async () => {
    const res = await logAs('admin@x.io', '?action=user.created');
    expect(auditPage.parse(res.body).data).toHaveLength(2);

    const all = await logAs('admin@x.io', '?limit=100');
    const actions = actionsOf(all).filter((action) => !action.startsWith('auth.login.success'));
    expect(actions.slice(0, 5)).toEqual([
      'user.unlocked',
      'auth.login.failed',
      'user.created',
      'user.updated',
      'user.created',
    ]);
  });

  it('shows a brand manager only the events of their own brand', async () => {
    const res = await logAs('pizza@x.io', '?limit=100');

    const rows = auditPage.parse(res.body).data;
    expect(rows.every((row) => row.brandId === world.pizza.id)).toBe(true);
    expect(rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['user.unlocked', 'user.updated', 'user.created']),
    );
    expect(rows.map((row) => row.action)).not.toContain('auth.login.failed');
  });

  it('names the people a viewer may see, and shows no name for one they may not', async () => {
    const res = await logAs('pizza@x.io', '?action=user.unlocked');

    const [row] = auditPage.parse(res.body).data;
    // The group admin did it, and a brand manager cannot see a group admin.
    expect(row?.userId).toBe(world.users.admin.id);
    expect(row?.userName).toBeNull();

    const own = await logAs('pizza@x.io', '?action=user.updated');
    expect(auditPage.parse(own.body).data[0]?.userName).toBe('Amal Pizza Manager');
  });

  it('is not allowed for a branch manager or a cashier', async () => {
    expect((await logAs('mall-manager@x.io')).status).toBe(403);
    expect((await logAs('cashier@x.io')).status).toBe(403);
  });

  it('needs a signed-in person', async () => {
    expect((await request(app).get('/api/v1/audit-logs')).status).toBe(401);
  });

  it('keeps the metadata of an event', async () => {
    const res = await logAs('admin@x.io', '?action=auth.login.failed');

    expect(auditPage.parse(res.body).data[0]?.metadata).toEqual({ email: 'x@y.z' });
  });
});

describe('GET /audit-logs: filters and pages', () => {
  beforeEach(addEvents);

  it('filters by action, person and branch', async () => {
    const byAction = await logAs('admin@x.io', '?action=user.updated');
    expect(actionsOf(byAction)).toEqual(['user.updated']);

    const byUser = await logAs('admin@x.io', `?userId=${world.users.burgerManager.id}`);
    expect(actionsOf(byUser)).toEqual(['user.created']);

    const byBranch = await logAs('admin@x.io', `?branchId=${world.mall.id}`);
    expect(actionsOf(byBranch)).toEqual(['user.updated']);
  });

  it('filters by a range of dates, ends included', async () => {
    const from = new Date(Date.UTC(2026, 9, 1, 12, 2)).toISOString();
    const to = new Date(Date.UTC(2026, 9, 1, 12, 4)).toISOString();

    const res = await logAs('admin@x.io', `?from=${from}&to=${to}`);

    expect(actionsOf(res)).toEqual(['auth.login.failed', 'user.created', 'user.updated']);
  });

  it('walks through the events newest first, with no repeats', async () => {
    const token = await signIn(app, 'admin@x.io');
    const seen: string[] = [];
    let cursor: string | null = null;

    do {
      const query: string = cursor ? `?limit=2&cursor=${cursor}` : '?limit=2';
      const page = auditPage.parse((await as(app, token).get(`/api/v1/audit-logs${query}`)).body);
      expect(page.data.length).toBeLessThanOrEqual(2);
      seen.push(...page.data.map((row) => row.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(6);
  });

  it.each(['?from=yesterday', '?to=2026-10-09', '?userId=x', '?limit=0', '?action='])(
    'rejects the query %s',
    async (query) => {
      expect((await logAs('admin@x.io', query)).status).toBe(400);
    },
  );
});

describe('the audit log records what people do', () => {
  it('shows a sign-in to the brand manager of that person', async () => {
    await signIn(app, 'cashier@x.io');

    const res = await logAs('pizza@x.io', '?action=auth.login.success');

    const rows = auditPage.parse(res.body).data;
    expect(rows.map((row) => row.userName)).toEqual(expect.arrayContaining(['Sara Cashier']));
  });

  it('shows the change a manager made, to that manager', async () => {
    const api = as(app, await signIn(app, 'pizza@x.io'));
    await api.patch(`/api/v1/users/${world.users.cashier.id}`, { name: 'Sara Renamed' });

    const res = await logAs('pizza@x.io', '?action=user.updated');

    const [row] = auditPage.parse(res.body).data;
    expect(row).toMatchObject({
      userName: 'Amal Pizza Manager',
      entityType: 'user',
      entityId: world.users.cashier.id,
      metadata: { changed: ['name'] },
    });
  });

  it('does not show another brand’s changes to a brand manager', async () => {
    const api = as(app, await signIn(app, 'burger@x.io'));
    await api.patch(`/api/v1/users/${world.users.burgerCashier.id}`, { name: 'Omar Renamed' });

    const res = await logAs('pizza@x.io', '?action=user.updated');

    expect(auditPage.parse(res.body).data).toHaveLength(0);
  });
});
