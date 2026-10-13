import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createTestPrisma, resetDatabase, testConfig } from '../../test/helpers';
import { createFirstAdmin, FirstAdminError } from './first-admin';
import { createPasswordHasher, hashProfiles } from './password';
import { syncSystemRoles } from './roles';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const app = createApp({ prisma, config: testConfig() });

beforeAll(() => syncSystemRoles(prisma));
// The tests of other files expect the built-in roles to be there.
afterAll(async () => {
  await syncSystemRoles(prisma);
  await prisma.$disconnect();
});
beforeEach(() => resetDatabase(prisma));

const signIn = (email: string, password: string) =>
  request(app).post('/api/v1/auth/login').send({ type: 'password', email, password });

describe('createFirstAdmin', () => {
  it('makes a group admin who can sign in with the password it gives back', async () => {
    const admin = await createFirstAdmin(prisma, hasher, {
      name: 'Owner One',
      email: 'owner@client.example',
    });

    const res = await signIn('owner@client.example', admin.password);

    expect(res.status).toBe(200);
    const body = res.body as { user: { name: string; role: { key: string }; brandId: unknown } };
    expect(body.user).toMatchObject({
      name: 'Owner One',
      role: { key: 'group_admin' },
      brandId: null,
    });
  });

  it('gives a password that is hard to guess, and keeps only its hash', async () => {
    const admin = await createFirstAdmin(prisma, hasher, { name: 'Owner', email: 'o@x.io' });

    expect(admin.password).toHaveLength(16);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(stored.passwordHash).toMatch(/^scrypt\$/);
    expect(stored.passwordHash).not.toContain(admin.password);
    expect(await hasher.verify(admin.password, stored.passwordHash ?? '')).toBe(true);
  });

  it('gives a new password every time', async () => {
    const first = await createFirstAdmin(prisma, hasher, { name: 'A', email: 'a@x.io' });
    const second = await createFirstAdmin(prisma, hasher, { name: 'B', email: 'b@x.io' });

    expect(first.password).not.toBe(second.password);
  });

  it('writes the email in lower case and trims the name and the email', async () => {
    const admin = await createFirstAdmin(prisma, hasher, {
      name: '  Owner  ',
      email: '  Owner@Client.Example ',
    });

    expect(admin.email).toBe('owner@client.example');
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(stored).toMatchObject({ name: 'Owner', email: 'owner@client.example' });
  });

  it('refuses an email that is already used, whatever its capital letters', async () => {
    await createFirstAdmin(prisma, hasher, { name: 'Owner', email: 'owner@x.io' });

    await expect(
      createFirstAdmin(prisma, hasher, { name: 'Other', email: 'OWNER@x.io' }),
    ).rejects.toThrow('The email owner@x.io is already used.');
    expect(await prisma.user.count()).toBe(1);
  });

  it.each([
    ['an email that is not an email', { name: 'Owner', email: 'owner' }, /email/],
    ['an empty email', { name: 'Owner', email: '  ' }, /email/],
    ['an empty name', { name: '   ', email: 'o@x.io' }, /name/],
    ['a name that is too long', { name: 'x'.repeat(101), email: 'o@x.io' }, /name/],
  ])('refuses %s, with a sentence that says what is wrong', async (_label, input, pattern) => {
    const attempt = createFirstAdmin(prisma, hasher, input);

    await expect(attempt).rejects.toBeInstanceOf(FirstAdminError);
    await expect(attempt).rejects.toThrow(pattern);
    expect(await prisma.user.count()).toBe(0);
  });

  it('writes the built-in roles first, in a database that never had them', async () => {
    await prisma.role.deleteMany();

    const admin = await createFirstAdmin(prisma, hasher, { name: 'Owner', email: 'o@x.io' });

    expect((await signIn('o@x.io', admin.password)).status).toBe(200);
    expect(await prisma.role.count()).toBeGreaterThan(1);
  });

  it('leaves a line in the audit log, with nobody as the person who did it', async () => {
    const admin = await createFirstAdmin(prisma, hasher, { name: 'Owner', email: 'o@x.io' });

    const rows = await prisma.auditLog.findMany();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'user.created',
      userId: null,
      entityType: 'user',
      entityId: admin.id,
      metadata: { role: 'group_admin', source: 'admin:create' },
    });
    expect(JSON.stringify(rows[0])).not.toContain(admin.password);
  });
});
