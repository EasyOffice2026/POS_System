import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createPasswordHasher, hashProfiles } from '../src/lib/password';
import { syncSystemRoles } from '../src/lib/roles';
import { createMemoryStorage } from '../src/lib/storage';
import { imageTypeOf } from '../src/modules/uploads/uploads.router';
import { createTestPrisma, resetDatabase, testConfig } from './helpers';
import { as, createUsersWorld, signIn, type UsersWorld } from './users-world';

// POST /uploads/images: a photo for a dish or a brand logo, kept in storage (spec: README,
// "Photos"). Tests use the memory storage of lib/storage.ts.
const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const storage = createMemoryStorage();
const app = createApp({ prisma, config: testConfig(), storage });
let world: UsersWorld;

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  storage.files.clear();
  world = await createUsersWorld(prisma, hasher);
});

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x40, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
  Buffer.alloc(56, 3),
]);

describe('reading the kind of an image', () => {
  it('knows jpeg, png and webp by their first bytes, and nothing else', () => {
    expect(imageTypeOf(new Uint8Array(jpeg))).toEqual({ type: 'image/jpeg', ext: 'jpg' });
    expect(imageTypeOf(new Uint8Array(png))).toEqual({ type: 'image/png', ext: 'png' });
    expect(imageTypeOf(new Uint8Array(webp))).toEqual({ type: 'image/webp', ext: 'webp' });
    expect(imageTypeOf(new Uint8Array(Buffer.from('<svg xmlns="x"/>')))).toBeNull();
    expect(imageTypeOf(new Uint8Array())).toBeNull();
  });
});

describe('POST /api/v1/uploads/images', () => {
  it('keeps a dish photo under the brand and answers its address', async () => {
    const api = as(app, await signIn(app, 'pizza@x.io'));
    const res = await api
      .post('/api/v1/uploads/images?kind=item')
      .set('Content-Type', 'image/png')
      .send(png);
    expect(res.status).toBe(201);
    const { url } = res.body as { url: string };
    expect(url).toMatch(
      new RegExp(`^https://files.test/${world.pizza.id}/item/[0-9a-f-]{36}\\.png$`),
    );
    const [path, file] = [...storage.files.entries()][0] ?? [];
    expect(url.endsWith(path ?? '?')).toBe(true);
    expect(file?.contentType).toBe('image/png');
    expect(file?.bytes.length).toBe(png.length);
  });

  it('trusts the bytes, not the declared type', async () => {
    const api = as(app, await signIn(app, 'pizza@x.io'));
    const res = await api
      .post('/api/v1/uploads/images?kind=item')
      .set('Content-Type', 'image/png')
      .send(jpeg);
    expect(res.status).toBe(201);
    expect((res.body as { url: string }).url.endsWith('.jpg')).toBe(true);
    expect([...storage.files.values()][0]?.contentType).toBe('image/jpeg');
  });

  it('refuses a file that is not a jpeg, png or webp', async () => {
    const api = as(app, await signIn(app, 'pizza@x.io'));
    const res = await api
      .post('/api/v1/uploads/images?kind=item')
      .set('Content-Type', 'image/svg+xml')
      .send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    expect(res.status).toBe(400);
    expect((res.body as { error: { details: { message: string }[] } }).error.details).toEqual([
      { path: 'file', message: 'IMAGE_INVALID' },
    ]);
    expect(storage.files.size).toBe(0);
  });

  it('refuses a body that is not sent as an image at all', async () => {
    const api = as(app, await signIn(app, 'pizza@x.io'));
    const res = await api.post('/api/v1/uploads/images?kind=item').send({ url: 'x' });
    expect(res.status).toBe(400);
  });

  it('needs the right for the kind: a brand manager may not upload a logo', async () => {
    const api = as(app, await signIn(app, 'pizza@x.io'));
    const res = await api
      .post('/api/v1/uploads/images?kind=logo')
      .set('Content-Type', 'image/png')
      .send(png);
    expect(res.status).toBe(403);
  });

  it('lets a group admin upload a logo for the brand named', async () => {
    const api = as(app, await signIn(app, 'admin@x.io'));
    const res = await api
      .post(`/api/v1/uploads/images?kind=logo&brandId=${world.burger.id}`)
      .set('Content-Type', 'image/webp')
      .send(webp);
    expect(res.status).toBe(201);
    expect((res.body as { url: string }).url).toContain(`/${world.burger.id}/logo/`);

    const without = await api
      .post('/api/v1/uploads/images?kind=logo')
      .set('Content-Type', 'image/webp')
      .send(webp);
    expect(without.status).toBe(400);
    expect((without.body as { error: { details: unknown } }).error.details).toEqual([
      { path: 'brandId', message: 'BRAND_REQUIRED' },
    ]);
  });

  it('answers 409 STORAGE_NOT_SET_UP when the server has no storage settings', async () => {
    const bare = createApp({ prisma, config: testConfig() });
    const api = as(bare, await signIn(bare, 'pizza@x.io'));
    const res = await api
      .post('/api/v1/uploads/images?kind=item')
      .set('Content-Type', 'image/png')
      .send(png);
    expect(res.status).toBe(409);
    expect((res.body as { error: { code: string } }).error.code).toBe('STORAGE_NOT_SET_UP');
  });
});
