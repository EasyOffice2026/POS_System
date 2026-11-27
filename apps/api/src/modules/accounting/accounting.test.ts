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
    PURCHASING_IN_ERP: 'true',
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

describe('stock from the accounting system', () => {
  const post = (key: string, body: object) =>
    request(app).post('/api/v1/accounting/stock').set('Authorization', `Bearer ${key}`).send(body);

  it('receives goods once per key, at the average cost, and moves transfers', async () => {
    const key = await newKey();
    const flour = await prisma.ingredient.create({
      data: {
        brandId: world.pizza.id,
        name: { en: 'Flour', ar: 'طحين' },
        searchText: 'flour',
        unit: 'kg',
        costPerUnit: '0.200',
      },
    });
    await prisma.branchStock.create({
      data: {
        branchId: world.mall.id,
        ingredientId: flour.id,
        brandId: world.pizza.id,
        quantity: '10',
      },
    });
    const body = {
      key: 'proc_receive:1',
      branchId: world.mall.id,
      kind: 'received',
      lines: [{ ingredientId: flour.id, quantity: '10.000', unitCost: '0.300' }],
    };
    expect((await post(key, body)).status).toBe(201);
    expect((await post(key, body)).status).toBe(200);
    const stock = await prisma.branchStock.findUniqueOrThrow({
      where: { branchId_ingredientId: { branchId: world.mall.id, ingredientId: flour.id } },
    });
    expect(stock.quantity.toFixed(3)).toBe('20.000');
    const after = await prisma.ingredient.findUniqueOrThrow({ where: { id: flour.id } });
    expect(after.costPerUnit.toFixed(3)).toBe('0.250');

    const out = await post(key, {
      key: 'transfer_out:1',
      branchId: world.mall.id,
      kind: 'transfer_out',
      lines: [{ ingredientId: flour.id, quantity: '4' }],
    });
    expect(out.status).toBe(201);
    const moved = await prisma.stockMovement.findFirstOrThrow({ where: { kind: 'transfer_out' } });
    expect(moved.quantity.toFixed(3)).toBe('-4.000');
    expect(moved.unitCost?.toFixed(3)).toBe('0.250');

    const onHand = await withKey(key).get('/api/v1/accounting/stock-on-hand');
    expect(
      (onHand.body as { stock: { ingredientId: string; quantity: string; value: string }[] }).stock,
    ).toContainEqual({
      branchId: world.mall.id,
      ingredientId: flour.id,
      quantity: '16.000',
      value: '4.000',
    });
  });

  it('refuses an ingredient of another brand and lists the ingredients', async () => {
    const key = await newKey();
    const other = await prisma.brand.create({ data: { name: { en: 'Other', ar: 'أخرى' } } });
    const salt = await prisma.ingredient.create({
      data: { brandId: other.id, name: { en: 'Salt', ar: 'ملح' }, searchText: 'salt', unit: 'kg' },
    });
    const res = await post(key, {
      key: 'x:1',
      branchId: world.mall.id,
      kind: 'received',
      lines: [{ ingredientId: salt.id, quantity: '1' }],
    });
    expect(res.status).toBe(404);
    const list = await withKey(key).get('/api/v1/accounting/ingredients');
    expect((list.body as { ingredients: { id: string }[] }).ingredients.map((i) => i.id)).toContain(
      salt.id,
    );
    const costs = await withKey(key).get(
      '/api/v1/accounting/stock-costs?from=2026-11-01&to=2026-11-02',
    );
    expect(costs.status).toBe(200);
  });

  const write = (key: string, path: string, body: object) =>
    request(app)
      .post(`/api/v1/accounting/${path}`)
      .set('Authorization', `Bearer ${key}`)
      .send(body);
  const stockOf = async (ingredientId: string) =>
    (
      await prisma.branchStock.findUniqueOrThrow({
        where: { branchId_ingredientId: { branchId: world.mall.id, ingredientId } },
      })
    ).quantity.toFixed(3);

  it('makes a prepared item from its ingredients at what they cost, once per key', async () => {
    const key = await newKey();
    const made = async (name: string, unit: string) => {
      const res = await write(key, 'ingredients', {
        brandId: world.pizza.id,
        name: { en: name, ar: name },
        unit,
      });
      expect(res.status).toBe(200);
      return (res.body as { id: string }).id;
    };
    const flour = await made('Flour', 'kg');
    const oil = await made('Oil', 'l');
    const dough = await made('Dough', 'kg');
    const rename = await write(key, 'ingredients', {
      id: dough,
      brandId: world.pizza.id,
      name: { en: 'Pizza dough', ar: 'عجينة' },
      unit: 'g',
    });
    expect((rename.body as { unit: string }).unit).toBe('kg');
    const blank = await write(key, 'ingredients', {
      brandId: world.pizza.id,
      name: { en: 'Salt', ar: '' },
      unit: 'kg',
    });
    const salt = await prisma.ingredient.findUniqueOrThrow({
      where: { id: (blank.body as { id: string }).id },
    });
    expect(salt.name).toEqual({ en: 'Salt', ar: 'Salt' });
    await prisma.ingredient.update({ where: { id: salt.id }, data: { isActive: false } });
    await write(key, 'ingredients', {
      id: salt.id,
      brandId: world.pizza.id,
      name: { en: 'Sea salt', ar: 'ملح' },
      unit: 'kg',
    });
    expect((await prisma.ingredient.findUniqueOrThrow({ where: { id: salt.id } })).isActive).toBe(
      false,
    );
    await post(key, {
      key: 'opening:1',
      branchId: world.mall.id,
      kind: 'received',
      lines: [
        { ingredientId: flour, quantity: '10', unitCost: '0.300' },
        { ingredientId: oil, quantity: '2', unitCost: '1.000' },
      ],
    });
    const body = {
      key: 'production:1',
      branchId: world.mall.id,
      outputIngredientId: dough,
      outputQuantity: '12',
      inputs: [
        { ingredientId: flour, quantity: '10' },
        { ingredientId: oil, quantity: '1' },
      ],
    };
    const res = await write(key, 'production', body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      cost: '4.000',
      unitCost: '0.333',
      inputs: [
        { ingredientId: flour, cost: '3.000' },
        { ingredientId: oil, cost: '1.000' },
      ],
    });
    const again = await write(key, 'production', body);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ cost: '4.000', duplicate: true });
    expect(await stockOf(flour)).toBe('0.000');
    expect(await stockOf(oil)).toBe('1.000');
    expect(await stockOf(dough)).toBe('12.000');
    const cost = await prisma.ingredient.findUniqueOrThrow({ where: { id: dough } });
    expect(cost.costPerUnit.toFixed(3)).toBe('0.333');
    const loop = await write(key, 'production', {
      ...body,
      key: 'production:2',
      inputs: [{ ingredientId: dough, quantity: '1' }],
    });
    expect(loop.status).toBe(409);
  });

  it('spreads an invoice difference over the stock still held', async () => {
    const key = await newKey();
    const flour = await prisma.ingredient.create({
      data: {
        brandId: world.pizza.id,
        name: { en: 'Flour', ar: 'طحين' },
        searchText: 'flour',
        unit: 'kg',
      },
    });
    await post(key, {
      key: 'proc_receive:9',
      branchId: world.mall.id,
      kind: 'received',
      lines: [{ ingredientId: flour.id, quantity: '10', unitCost: '0.300' }],
    });
    await prisma.branchStock.update({
      where: { branchId_ingredientId: { branchId: world.mall.id, ingredientId: flour.id } },
      data: { quantity: '4' },
    });
    const res = await write(key, 'revalue', {
      key: 'invoice:9',
      branchId: world.mall.id,
      lines: [{ ingredientId: flour.id, receivedQuantity: '10', amount: '1.000' }],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      lines: [{ ingredientId: flour.id, applied: '0.400', unapplied: '0.600' }],
    });
    const after = await prisma.ingredient.findUniqueOrThrow({ where: { id: flour.id } });
    expect(after.costPerUnit.toFixed(3)).toBe('0.400');
    const small = await write(key, 'revalue', {
      key: 'invoice:10',
      branchId: world.mall.id,
      lines: [{ ingredientId: flour.id, receivedQuantity: '4', amount: '0.006' }],
    });
    expect(small.body).toMatchObject({ lines: [{ applied: '0.004', unapplied: '0.002' }] });
  });

  it('lists every dish with its price and recipe', async () => {
    const key = await newKey();
    const res = await withKey(key).get('/api/v1/accounting/recipes');
    expect(res.status).toBe(200);
    const items = (res.body as { items: { id: string; price: string }[] }).items;
    expect(items.map((i) => i.id)).toContain(world.items.margherita.id);
  });
});
