import { readFileSync } from 'node:fs';
import type { AccessTokenClaims } from '@pos/shared';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createTokenService } from '../lib/tokens';
import { createTestPrisma, testConfig } from '../../test/helpers';

// Every route of the API, found in the app itself, so a route added later is checked too.
// See docs/security-review.md.

const prisma = createTestPrisma();
const config = testConfig();
const app = createApp({ prisma, config });
afterAll(() => prisma.$disconnect());

interface Layer {
  handle: { stack?: Layer[] };
  route?: { path: string; methods: Record<string, boolean> };
  matchers: ((path: string) => unknown)[];
}

// The routes open to anybody: the health check, and signing in, refreshing and signing out,
// which carry their own proof (a password, a PIN or the refresh cookie).
const PUBLIC = new Set([
  'GET /api/v1/health/',
  'GET /api/v1/health/ready',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/logout',
]);

// The routes for anybody signed in, whatever their permissions, and why.
const SIGNED_IN = new Map([
  ['GET /api/v1/auth/me', 'a person reads their own account'],
  ['POST /api/v1/auth/password', 'a person changes their own password'],
  [
    'GET /api/v1/brands/:id/settings',
    'every terminal reads its brand settings; the scoped client limits it to the own brand',
  ],
]);

// The mount paths of app.ts, in the order of its v1.use calls; each call ends with its router.
function routes(): { method: string; path: string }[] {
  const source = readFileSync(new URL('../app.ts', import.meta.url), 'utf8');
  const mounts = [...source.matchAll(/v1\.use\(\s*'([^']+)'/g)].map((match) => match[1] ?? '');
  const appRouter = (app as unknown as { router: { stack: Layer[] } }).router;
  const v1 = appRouter.stack.find((layer) => layer.matchers[0]?.('/api/v1') && layer.handle.stack);
  const routers = (v1?.handle.stack ?? []).filter((layer) => Array.isArray(layer.handle.stack));
  expect(routers.length).toBe(mounts.length);

  return routers.flatMap((layer, index) => {
    const mount = mounts[index] ?? '';
    // The router found is the one mounted there.
    expect(layer.matchers[0]?.(mount)).toBeTruthy();
    const stack = layer.handle.stack ?? [];
    expect(stack.some((inner) => Array.isArray(inner.handle.stack))).toBe(false);
    return stack.flatMap((inner) =>
      inner.route
        ? Object.keys(inner.route.methods).map((method) => ({
            method: method.toUpperCase(),
            path: `/api/v1${mount}${inner.route?.path ?? ''}`,
          }))
        : [],
    );
  });
}

// A path with an id in place of each parameter.
const concrete = (path: string) =>
  path.replace(/:[a-zA-Z]+/g, '01990000-0000-7000-8000-00000000ffff');

function send(method: string, path: string, token?: string) {
  const agent = request(app);
  const call =
    method === 'GET'
      ? agent.get(path)
      : method === 'POST'
        ? agent.post(path)
        : method === 'PUT'
          ? agent.put(path)
          : method === 'PATCH'
            ? agent.patch(path)
            : agent.delete(path);
  const authed = token ? call.set('Authorization', `Bearer ${token}`) : call;
  return method === 'GET' || method === 'DELETE' ? authed : authed.send({});
}

describe('every route of the API', () => {
  const all = routes();

  it('is found, and none is listed twice', () => {
    expect(all.length).toBeGreaterThan(100);
    const keys = all.map((route) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of [...PUBLIC, ...SIGNED_IN.keys()]) expect(keys).toContain(key);
  });

  it('refuses a request without a token, but for the public ones', async () => {
    const open: string[] = [];
    for (const route of all) {
      const key = `${route.method} ${route.path}`;
      if (PUBLIC.has(key)) continue;
      const res = await send(route.method, concrete(route.path));
      if (res.status !== 401) open.push(`${key} -> ${res.status}`);
    }
    expect(open).toEqual([]);
  });

  it('refuses a token with no permissions, but for the routes of anybody signed in', async () => {
    const claims: AccessTokenClaims = {
      sub: '01990000-0000-7000-8000-00000000fffe',
      role: 'cashier',
      scope: 'BRANCH',
      brandId: '01990000-0000-7000-8000-00000000fffd',
      branchIds: ['01990000-0000-7000-8000-00000000fffc'],
      permissions: [],
    };
    const token = await createTokenService(config).signAccessToken(claims);
    const allowed: string[] = [];
    for (const route of all) {
      const key = `${route.method} ${route.path}`;
      if (PUBLIC.has(key) || SIGNED_IN.has(key)) continue;
      const res = await send(route.method, concrete(route.path), token);
      if (res.status !== 403) allowed.push(`${key} -> ${res.status}`);
    }
    expect(allowed).toEqual([]);
  });

  it('refuses a token that was changed or signed with another key', async () => {
    const claims: AccessTokenClaims = {
      sub: '01990000-0000-7000-8000-00000000fffe',
      role: 'group_admin',
      scope: 'GROUP',
      brandId: null,
      branchIds: [],
      permissions: ['brands:read'],
    };
    const forged = await createTokenService(
      testConfig({ JWT_ACCESS_SECRET: 'another-secret-that-is-at-least-32-characters' }),
    ).signAccessToken(claims);
    expect((await send('GET', '/api/v1/brands', forged)).status).toBe(401);

    const real = await createTokenService(config).signAccessToken(claims);
    const [head, body, signature] = real.split('.');
    const widened = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body ?? '', 'base64url').toString()),
        permissions: ['users:write'],
      }),
    ).toString('base64url');
    expect((await send('GET', '/api/v1/users', `${head}.${widened}.${signature}`)).status).toBe(
      401,
    );

    // A token that names no algorithm is never trusted.
    const none = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${body}.`;
    expect((await send('GET', '/api/v1/brands', none)).status).toBe(401);
  });
});
