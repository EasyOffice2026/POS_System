import { randomUUID } from 'node:crypto';
import { type Order, orderSchema } from '@pos/shared';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { openShift } from '../../../test/factories';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { createMenuWorld, type MenuWorld } from '../../../test/menu-world';
import { as, signIn } from '../../../test/users-world';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

// The link with the ERP: integration keys, the accounting figures, and single sign-on.
// See docs/specs/029-erp-link.md.
const ISSUER = 'https://erp.test';
const AUDIENCE = 'https://pos.test';
const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const erpKeys = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
const publicJwk = { ...(await exportJWK(erpKeys.publicKey)), kid: 'erp-1', alg: 'EdDSA' };
const app = createApp({
  prisma,
  config: testConfig({
    AUTH_RATE_LIMIT_MAX: '1000',
    SSO_ISSUER: ISSUER,
    SSO_AUDIENCE: AUDIENCE,
  }),
  ssoKeys: createLocalJWKSet({ keys: [publicJwk] }),
});

let world: MenuWorld;

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  world = await createMenuWorld(prisma, hasher);
  await prisma.brand.update({
    where: { id: world.pizza.id },
    data: {
      settings: {
        paymentMethods: [
          { key: 'knet', name: { en: 'KNET', ar: 'كي نت' }, isActive: true },
          {
            key: 'talabat',
            name: { en: 'Talabat', ar: 'طلبات' },
            isActive: true,
            commissionRate: '18',
          },
        ],
      },
    },
  });
  await openShift(prisma, world.users.mallManager, world.mall);
});

const ORDERS = '/api/v1/orders';
const KEYS = '/api/v1/integration-keys';
const asAdmin = async () => as(app, await signIn(app, 'admin@x.io'));
const withKey = (key: string) => ({
  get: (path: string) => request(app).get(path).set('Authorization', `Bearer ${key}`),
});

async function newKey(): Promise<string> {
  const res = await (await asAdmin()).post(KEYS, { name: 'nexera-erp' });
  expect(res.status).toBe(201);
  return (res.body as { key: string }).key;
}

// A Cola (5.000) and a Margherita (20.000): 5.000 in cash and 20.000 through Talabat.
async function paidOrder(): Promise<Order> {
  const api = as(app, await signIn(app, 'mall-manager@x.io'));
  const order = orderSchema.parse(
    (await api.post(ORDERS, { branchId: world.mall.id, type: 'takeaway' })).body,
  );
  await api.post(`${ORDERS}/${order.id}/lines`, { kind: 'item', itemId: world.items.cola.id });
  await api.post(`${ORDERS}/${order.id}/lines`, {
    kind: 'item',
    itemId: world.items.margherita.id,
  });
  const res = await api.post(`${ORDERS}/${order.id}/pay`, {
    tenders: [
      { id: randomUUID(), method: 'cash', amount: '5.000', tendered: '5.000' },
      { id: randomUUID(), method: 'talabat', amount: '20.000', reference: 'T-1' },
    ],
  });
  expect(res.status).toBe(200);
  return orderSchema.parse(res.body);
}

describe('integration keys', () => {
  it('are made and revoked by a group administrator only', async () => {
    const manager = as(app, await signIn(app, 'mall-manager@x.io'));
    expect((await manager.post(KEYS, { name: 'x' })).status).toBe(403);

    const key = await newKey();
    expect(key.startsWith('posk_')).toBe(true);
    const admin = await asAdmin();
    const list = (await admin.get(KEYS)).body as { id: string; lastUsedAt: string | null }[];
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(key);

    expect((await withKey(key).get('/api/v1/accounting/structure')).status).toBe(200);
    expect((await admin.delete(`${KEYS}/${list[0]?.id}`)).status).toBe(204);
    expect((await withKey(key).get('/api/v1/accounting/structure')).status).toBe(401);
  });

  it('are needed to read the accounting figures', async () => {
    expect((await request(app).get('/api/v1/accounting/structure')).status).toBe(401);
    expect((await withKey('posk_wrong').get('/api/v1/accounting/structure')).status).toBe(401);
    const token = await signIn(app, 'admin@x.io');
    const asPerson = await request(app)
      .get('/api/v1/accounting/structure')
      .set('Authorization', `Bearer ${token}`);
    expect(asPerson.status).toBe(401);
  });
});

describe('accounting figures', () => {
  it('lists the brands, branches and ways of payment', async () => {
    const res = await withKey(await newKey()).get('/api/v1/accounting/structure');
    const brands = (res.body as { brands: { id: string; paymentMethods: { key: string }[] }[] })
      .brands;
    const pizza = brands.find((brand) => brand.id === world.pizza.id);
    expect(pizza?.paymentMethods.map((method) => method.key)).toEqual(['cash', 'knet', 'talabat']);
  });

  it('gives each branch day its sales by way of payment, with the commission', async () => {
    const order = await paidOrder();
    const key = await newKey();
    const date = order.businessDate;
    const res = await withKey(key).get(`/api/v1/accounting/days?from=${date}&to=${date}`);
    expect(res.status).toBe(200);
    const days = (res.body as { days: Record<string, unknown>[] }).days;
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({
      id: `day:${world.mall.id}:${date}`,
      branchId: world.mall.id,
      brandId: world.pizza.id,
      businessDate: date,
      orders: 1,
      gross: '25.000',
      discounts: '0.000',
      net: '25.000',
      refunds: [],
      cashDifference: '0.000',
    });
    expect(days[0]?.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'cash', amount: '5.000', commission: '0.000' }),
        expect.objectContaining({ method: 'talabat', amount: '20.000', commission: '3.600' }),
      ]),
    );
  });

  it('refuses a range that is back to front or too long', async () => {
    const key = await newKey();
    const back = await withKey(key).get('/api/v1/accounting/days?from=2026-11-02&to=2026-11-01');
    expect(back.status).toBe(400);
    const long = await withKey(key).get('/api/v1/accounting/days?from=2026-01-01&to=2026-03-01');
    expect(long.status).toBe(400);
  });

  it('has no goods receipts before anything is received', async () => {
    const res = await withKey(await newKey()).get(
      '/api/v1/accounting/goods-receipts?from=2026-11-01&to=2026-11-30',
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ receipts: [] });
  });
});

describe('single sign-on from the ERP', () => {
  const ticket = (claims: { email?: string; audience?: string; jti?: string } = {}) =>
    new SignJWT({ email: claims.email ?? 'admin@x.io' })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'erp-1' })
      .setIssuer(ISSUER)
      .setAudience(claims.audience ?? AUDIENCE)
      .setJti(claims.jti ?? randomUUID())
      .setIssuedAt()
      .setExpirationTime('60s')
      .sign(erpKeys.privateKey);
  const sso = (value: string) => request(app).post('/api/v1/auth/sso').send({ ticket: value });

  it('signs the person in once per ticket', async () => {
    const value = await ticket();
    const first = await sso(value);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ user: { email: 'admin@x.io' } });
    expect(first.headers['set-cookie']).toBeDefined();
    expect((await sso(value)).status).toBe(401);
  });

  it('refuses a ticket for another system, or for nobody it knows', async () => {
    expect((await sso(await ticket({ audience: 'https://other.test' }))).status).toBe(401);
    expect((await sso(await ticket({ email: 'nobody@x.io' }))).status).toBe(401);
    expect((await sso('not-a-ticket')).status).toBe(401);
  });
});
