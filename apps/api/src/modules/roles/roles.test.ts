import { permissions, roleInfoSchema, roleKeys, systemRoles } from '@pos/shared';
import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { as, createUsersWorld, signIn } from '../../../test/users-world';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const app = createApp({ prisma, config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }) });
const roleList = z.object({ data: z.array(roleInfoSchema) });

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  await createUsersWorld(prisma, hasher);
});

async function rolesAs(email: string) {
  return as(app, await signIn(app, email)).get('/api/v1/roles');
}

describe('GET /roles', () => {
  it('lists the built-in roles in the usual order, with their scope and permissions', async () => {
    const res = await rolesAs('admin@x.io');

    expect(res.status).toBe(200);
    const { data } = roleList.parse(res.body);
    expect(data.map((role) => role.key)).toEqual([...roleKeys]);
    const cashier = data.find((role) => role.key === 'cashier');
    expect(cashier).toMatchObject({
      scope: 'BRANCH',
      name: 'Cashier',
      permissions: ['menu:read', 'orders:read', 'orders:write'],
    });
  });

  it('shows the permission matrix as the code defines it', async () => {
    const { data } = roleList.parse((await rolesAs('admin@x.io')).body);

    for (const definition of systemRoles) {
      const role = data.find((entry) => entry.key === definition.key);
      expect([...(role?.permissions ?? [])].sort()).toEqual([...definition.permissions].sort());
    }
    expect(data.find((role) => role.key === 'group_admin')?.permissions).toHaveLength(
      permissions.length,
    );
  });

  it('lets a group admin give every role', async () => {
    const { data } = roleList.parse((await rolesAs('admin@x.io')).body);

    expect(data.every((role) => role.assignable)).toBe(true);
  });

  it('does not let a brand manager give the group admin role', async () => {
    const { data } = roleList.parse((await rolesAs('pizza@x.io')).body);

    expect(data.find((role) => role.key === 'group_admin')?.assignable).toBe(false);
    expect(data.filter((role) => role.assignable)).toHaveLength(roleKeys.length - 1);
  });

  it('is not allowed for roles without roles:read', async () => {
    expect((await rolesAs('cashier@x.io')).status).toBe(403);
    expect((await rolesAs('mall-manager@x.io')).status).toBe(403);
  });

  it('needs a signed-in person', async () => {
    expect((await request(app).get('/api/v1/roles')).status).toBe(401);
  });
});
