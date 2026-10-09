import { brandSchema, pageSchema } from '@pos/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { as, createUsersWorld, errorOf, signIn, type UsersWorld } from '../../../test/users-world';
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

const BRANDS = '/api/v1/brands';
const asAdmin = async () => as(app, await signIn(app, 'admin@x.io'));
const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));
const auditRows = (action: string) => prisma.auditLog.findMany({ where: { action } });

const name = { en: 'Noodle House', ar: 'بيت النودلز' };

function messagesOf(res: request.Response): string[] {
  return (errorOf(res).details ?? []).map((detail) => `${detail.path}:${detail.message}`);
}

describe('POST /brands', () => {
  it('lets a group admin create a brand, which then shows in the list and in the audit log', async () => {
    const api = await asAdmin();

    const res = await api.post(BRANDS, { name });

    expect(res.status).toBe(201);
    const brand = brandSchema.parse(res.body);
    expect(brand).toMatchObject({ name, logoUrl: null, isActive: true });

    const list = pageSchema(brandSchema).parse((await api.get(BRANDS)).body);
    expect(list.data.map((b) => b.id)).toContain(brand.id);

    const [row] = await auditRows('brand.created');
    expect(row).toMatchObject({
      userId: world.users.admin.id,
      brandId: brand.id,
      entityType: 'brand',
      entityId: brand.id,
    });
    expect(row?.metadata).toEqual({ name, isActive: true });
  });

  it('can start a brand as inactive, with a link to its logo', async () => {
    const api = await asAdmin();

    const res = await api.post(BRANDS, {
      name,
      logoUrl: 'https://cdn.example.com/noodles.png',
      isActive: false,
    });

    expect(res.status).toBe(201);
    expect(brandSchema.parse(res.body)).toMatchObject({
      logoUrl: 'https://cdn.example.com/noodles.png',
      isActive: false,
    });
  });

  it('trims the names', async () => {
    const api = await asAdmin();

    const res = await api.post(BRANDS, { name: { en: '  Noodle House ', ar: ' بيت النودلز  ' } });

    expect(brandSchema.parse(res.body).name).toEqual(name);
  });

  it('refuses a name with only an English value, and creates nothing', async () => {
    const api = await asAdmin();
    const before = await prisma.brand.count();

    const res = await api.post(BRANDS, { name: { en: 'Noodle House' } });

    expect(res.status).toBe(400);
    expect(errorOf(res).code).toBe('VALIDATION_ERROR');
    expect(messagesOf(res)).toEqual(['name.ar:NAME_REQUIRED']);
    expect(await prisma.brand.count()).toBe(before);
    expect(await auditRows('brand.created')).toHaveLength(0);
  });

  it('counts a blank name as missing', async () => {
    const api = await asAdmin();

    const res = await api.post(BRANDS, { name: { en: '   ', ar: 'بيت النودلز' } });

    expect(messagesOf(res)).toEqual(['name.en:NAME_REQUIRED']);
  });

  it.each([
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'ftp://example.com/a.png',
    'logo.png',
  ])('refuses the logo link %s', async (logoUrl) => {
    const api = await asAdmin();

    const res = await api.post(BRANDS, { name, logoUrl });

    expect(messagesOf(res)).toEqual(['logoUrl:LOGO_URL_INVALID']);
  });

  it('refuses fields it does not know, such as an id', async () => {
    const api = await asAdmin();

    const res = await api.post(BRANDS, { name, id: world.burger.id });

    expect(res.status).toBe(400);
  });

  it('is not allowed for a brand manager, whatever they send', async () => {
    const api = await asPizzaManager();

    const valid = await api.post(BRANDS, { name });
    const invalid = await api.post(BRANDS, {});

    expect(valid.status).toBe(403);
    expect(errorOf(valid).code).toBe('FORBIDDEN');
    expect(invalid.status).toBe(403);
    expect(await auditRows('brand.created')).toHaveLength(0);
  });

  it('is not allowed for a branch manager or a cashier', async () => {
    for (const email of ['mall-manager@x.io', 'cashier@x.io']) {
      const api = as(app, await signIn(app, email));

      expect((await api.post(BRANDS, { name })).status).toBe(403);
    }
  });

  it('needs a signed-in person', async () => {
    const res = await request(app).post(BRANDS).send({ name });

    expect(res.status).toBe(401);
  });
});

describe('GET /brands/:id', () => {
  it('shows a group admin any brand and a brand manager their own', async () => {
    const admin = await asAdmin();
    const manager = await asPizzaManager();

    expect(brandSchema.parse((await admin.get(`${BRANDS}/${world.burger.id}`)).body).id).toBe(
      world.burger.id,
    );
    expect(brandSchema.parse((await manager.get(`${BRANDS}/${world.pizza.id}`)).body).id).toBe(
      world.pizza.id,
    );
  });

  it('answers the same for a brand of somebody else as for one that does not exist', async () => {
    const manager = await asPizzaManager();

    const other = await manager.get(`${BRANDS}/${world.burger.id}`);
    const missing = await manager.get(`${BRANDS}/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b`);

    expect(other.status).toBe(404);
    expect(other.body).toEqual(missing.body);
  });

  it('is not allowed for roles without brands:read', async () => {
    for (const email of ['mall-manager@x.io', 'cashier@x.io']) {
      const api = as(app, await signIn(app, email));

      expect((await api.get(`${BRANDS}/${world.pizza.id}`)).status).toBe(403);
    }
  });

  it('refuses an id that is not a UUID', async () => {
    const api = await asAdmin();

    expect((await api.get(`${BRANDS}/nope`)).status).toBe(400);
  });
});

describe('PATCH /brands/:id', () => {
  it('lets a group admin rename a brand, and writes what changed to the audit log', async () => {
    const api = await asAdmin();

    const res = await api.patch(`${BRANDS}/${world.pizza.id}`, {
      name: { en: 'Pizza Palace', ar: 'بيتزا بالاس' },
    });

    expect(res.status).toBe(200);
    expect(brandSchema.parse(res.body).name).toEqual({ en: 'Pizza Palace', ar: 'بيتزا بالاس' });

    const [row] = await auditRows('brand.updated');
    expect(row).toMatchObject({
      userId: world.users.admin.id,
      brandId: world.pizza.id,
      entityType: 'brand',
      entityId: world.pizza.id,
    });
    expect(row?.metadata).toEqual({ changed: ['name'] });
  });

  it('deactivates a brand and keeps everything that belongs to it', async () => {
    const api = await asAdmin();
    const branches = await prisma.branch.count({ where: { brandId: world.pizza.id } });
    const users = await prisma.user.count({ where: { brandId: world.pizza.id } });

    const res = await api.patch(`${BRANDS}/${world.pizza.id}`, { isActive: false });

    expect(res.status).toBe(200);
    expect(brandSchema.parse(res.body).isActive).toBe(false);
    expect(await prisma.branch.count({ where: { brandId: world.pizza.id } })).toBe(branches);
    expect(await prisma.user.count({ where: { brandId: world.pizza.id } })).toBe(users);

    const [row] = await auditRows('brand.updated');
    expect(row?.metadata).toEqual({ changed: ['isActive'], isActive: false });
  });

  it('activates a brand again', async () => {
    const api = await asAdmin();
    await api.patch(`${BRANDS}/${world.pizza.id}`, { isActive: false });

    const res = await api.patch(`${BRANDS}/${world.pizza.id}`, { isActive: true });

    expect(brandSchema.parse(res.body).isActive).toBe(true);
    expect(await auditRows('brand.updated')).toHaveLength(2);
  });

  it('sets and clears the logo link', async () => {
    const api = await asAdmin();

    const set = await api.patch(`${BRANDS}/${world.pizza.id}`, {
      logoUrl: 'https://cdn.example.com/pizza.png',
    });
    const cleared = await api.patch(`${BRANDS}/${world.pizza.id}`, { logoUrl: null });

    expect(brandSchema.parse(set.body).logoUrl).toBe('https://cdn.example.com/pizza.png');
    expect(brandSchema.parse(cleared.body).logoUrl).toBeNull();
  });

  it('says nothing and writes nothing when nothing changes', async () => {
    const api = await asAdmin();
    const current = brandSchema.parse((await api.get(`${BRANDS}/${world.pizza.id}`)).body);

    const res = await api.patch(`${BRANDS}/${world.pizza.id}`, {
      name: current.name,
      isActive: true,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(current);
    expect(await auditRows('brand.updated')).toHaveLength(0);
  });

  it('refuses a request that changes nothing at all', async () => {
    const api = await asAdmin();

    const res = await api.patch(`${BRANDS}/${world.pizza.id}`, {});

    expect(messagesOf(res)).toEqual([':NOTHING_TO_UPDATE']);
  });

  it('wants both names when a name is sent', async () => {
    const api = await asAdmin();

    const res = await api.patch(`${BRANDS}/${world.pizza.id}`, { name: { en: 'Pizza Palace' } });

    expect(res.status).toBe(400);
    expect(messagesOf(res)).toEqual(['name.ar:NAME_REQUIRED']);
    const stored = await prisma.brand.findUniqueOrThrow({ where: { id: world.pizza.id } });
    expect(stored.name).toEqual({ en: 'Pizza', ar: 'Pizza (ar)' });
  });

  it('refuses fields it does not know', async () => {
    const api = await asAdmin();

    const res = await api.patch(`${BRANDS}/${world.pizza.id}`, {
      isActive: true,
      createdAt: '2020-01-01T00:00:00.000Z',
    });

    expect(res.status).toBe(400);
  });

  it('is not allowed for a brand manager, even for their own brand', async () => {
    const api = await asPizzaManager();

    const res = await api.patch(`${BRANDS}/${world.pizza.id}`, { isActive: false });

    expect(res.status).toBe(403);
    expect((await prisma.brand.findUniqueOrThrow({ where: { id: world.pizza.id } })).isActive).toBe(
      true,
    );
  });

  it('answers that a brand was not found when it does not exist', async () => {
    const api = await asAdmin();

    const res = await api.patch(`${BRANDS}/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b`, {
      isActive: false,
    });

    expect(res.status).toBe(404);
    expect(errorOf(res).code).toBe('NOT_FOUND');
  });

  it('shows a deactivated brand to the group admin, who can still list it', async () => {
    const api = await asAdmin();
    await api.patch(`${BRANDS}/${world.burger.id}`, { isActive: false });

    const list = pageSchema(brandSchema).parse((await api.get(BRANDS)).body);

    expect(Object.fromEntries(list.data.map((b) => [b.id, b.isActive]))).toEqual({
      [world.pizza.id]: true,
      [world.burger.id]: false,
    });
  });
});

describe('the audit log of brands', () => {
  it('shows a brand manager the changes of their own brand and none of another', async () => {
    const admin = await asAdmin();
    await admin.patch(`${BRANDS}/${world.pizza.id}`, { isActive: false });
    await admin.patch(`${BRANDS}/${world.burger.id}`, { isActive: false });

    const manager = await asPizzaManager();
    const res = await manager.get('/api/v1/audit-logs?action=brand.updated');

    const rows = (res.body as { data: { entityId: string }[] }).data;
    expect(rows.map((row) => row.entityId)).toEqual([world.pizza.id]);
  });
});
