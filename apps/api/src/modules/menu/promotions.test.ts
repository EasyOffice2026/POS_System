import { type Order, orderSchema, type Promotion, promotionSchema } from '@pos/shared';
import type request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../app';
import { createItem, createUser } from '../../../test/factories';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { createMenuWorld, type MenuWorld } from '../../../test/menu-world';
import { as, errorOf, signIn } from '../../../test/users-world';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const app = createApp({ prisma, config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }) });

let world: MenuWorld;

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  world = await createMenuWorld(prisma, hasher);
  await createUser(prisma, hasher, {
    roleKey: 'marketing',
    name: 'Mira Marketing',
    brandId: world.pizza.id,
    email: 'marketing@x.io',
  });
});

type Api = ReturnType<typeof as>;
const PROMOTIONS = '/api/v1/menu/promotions';
const ORDERS = '/api/v1/orders';
const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));
const asCashier = async () => as(app, await signIn(app, 'cashier@x.io'));

const promotionOf = (res: request.Response): Promotion => promotionSchema.parse(res.body);
const orderOf = (res: request.Response): Order => orderSchema.parse(res.body);
const messagesOf = (res: request.Response) =>
  (errorOf(res).details ?? []).map((detail) => `${detail.path}:${detail.message}`);

async function addPromotion(api: Api, body: object) {
  const res = await api.post(PROMOTIONS, { name: { en: 'Promo', ar: 'عرض' }, ...body });
  expect(res.status).toBe(201);
  return promotionOf(res);
}

async function openOrder(api: Api, branchId = world.mall.id) {
  return orderOf(await api.post(ORDERS, { branchId, type: 'takeaway' }));
}

async function add(api: Api, orderId: string, itemId: string, quantity = 1) {
  const res = await api.post(`${ORDERS}/${orderId}/lines`, { kind: 'item', itemId, quantity });
  expect(res.status).toBe(200);
  return orderOf(res);
}

describe('promotions in the back office', () => {
  it('are added by marketing, listed, and a code is unique in the brand (criterion 6)', async () => {
    const marketing = as(app, await signIn(app, 'marketing@x.io'));
    const welcome = await addPromotion(marketing, {
      name: { en: 'Welcome', ar: 'أهلًا' },
      kind: 'percent_off',
      value: '10',
      code: 'welcome',
    });
    expect(welcome).toMatchObject({
      kind: 'percent_off',
      value: '10.00',
      code: 'WELCOME',
      appliesTo: 'all',
    });

    const again = await marketing.post(PROMOTIONS, {
      name: { en: 'Again', ar: 'مرة أخرى' },
      kind: 'amount_off',
      value: '1',
      code: 'WELCOME',
    });
    expect(messagesOf(again)).toEqual(['code:PROMO_CODE_TAKEN']);

    const list = z
      .object({ data: z.array(promotionSchema) })
      .parse((await marketing.get(PROMOTIONS)).body);
    expect(list.data.map((row) => row.name.en)).toEqual(['Welcome']);
    await expect(
      prisma.auditLog.findMany({ where: { action: 'menu.promotion.created' } }),
    ).resolves.toHaveLength(1);

    expect(
      (
        await (
          await asCashier()
        ).post(PROMOTIONS, { name: { en: 'X', ar: 'س' }, kind: 'percent_off', value: '5' })
      ).status,
    ).toBe(403);
  });

  it('refuse a category of another brand, and are changed as a whole', async () => {
    const api = await asPizzaManager();
    const other = await api.post(PROMOTIONS, {
      name: { en: 'X', ar: 'س' },
      kind: 'percent_off',
      value: '5',
      appliesTo: 'categories',
      categoryIds: [world.categories.burgers.id],
    });
    expect(messagesOf(other)).toEqual(['categoryIds.0:CATEGORY_NOT_FOUND']);

    const promo = await addPromotion(api, { kind: 'percent_off', value: '5' });
    const changed = promotionOf(
      await api.patch(`${PROMOTIONS}/${promo.id}`, {
        name: { en: 'Drinks', ar: 'مشروبات' },
        kind: 'percent_off',
        value: '15',
        appliesTo: 'categories',
        categoryIds: [world.categories.drinks.id],
        isActive: false,
      }),
    );
    expect(changed).toMatchObject({
      value: '15.00',
      isActive: false,
      categoryIds: [world.categories.drinks.id],
    });
  });
});

describe('promotions on an order', () => {
  it('take a percentage off drinks added in the hours of a happy hour (criterion 1)', async () => {
    await addPromotion(await asPizzaManager(), {
      name: { en: 'Happy hour', ar: 'ساعة سعيدة' },
      kind: 'percent_off',
      value: '20',
      appliesTo: 'categories',
      categoryIds: [world.categories.drinks.id],
      startTime: '15:00',
      endTime: '18:00',
    });
    const api = await asCashier();
    const order = await openOrder(api);
    const first = await add(api, order.id, world.items.cola.id);
    const second = await add(api, order.id, world.items.cola.id, 2);
    // 16:00 and 18:30 at the branch (UTC+3).
    await prisma.orderLine.update({
      where: { id: first.lines[0]?.id },
      data: { createdAt: new Date('2026-10-14T13:00:00Z') },
    });
    await prisma.orderLine.update({
      where: { id: second.lines[1]?.id },
      data: { createdAt: new Date('2026-10-14T15:30:00Z') },
    });

    const settled = await add(api, order.id, world.items.margherita.id);
    expect(settled).toMatchObject({
      subtotal: '35.000',
      promotionDiscount: '1.000',
      total: '34.000',
    });
    expect(settled.promotions.map((row) => [row.name.en, row.amount])).toEqual([
      ['Happy hour', '1.000'],
    ]);
  });

  it('give the cheapest of a group of three pizzas free (criterion 2)', async () => {
    await addPromotion(await asPizzaManager(), {
      name: { en: 'Buy 2 get 1', ar: '2 + 1' },
      kind: 'buy_get',
      buyQuantity: 2,
      getQuantity: 1,
      appliesTo: 'categories',
      categoryIds: [world.categories.pizzas.id],
    });
    const small = await createItem(
      prisma,
      world.pizza.id,
      world.categories.pizzas.id,
      'Small',
      '18.000',
    );
    const api = await asCashier();
    const order = await openOrder(api);
    await add(api, order.id, world.items.pepperoni.id);
    await add(api, order.id, world.items.margherita.id, 2);
    const settled = await add(api, order.id, small.id);
    expect(settled).toMatchObject({
      subtotal: '82.000',
      promotionDiscount: '20.000',
      total: '62.000',
    });
  });

  it('take a code off when typed, and put it back when removed (criterion 3)', async () => {
    await addPromotion(await asPizzaManager(), {
      name: { en: 'Welcome', ar: 'أهلًا' },
      kind: 'percent_off',
      value: '10',
      code: 'WELCOME',
    });
    const family = await createItem(
      prisma,
      world.pizza.id,
      world.categories.pizzas.id,
      'Family',
      '30.000',
    );
    const api = await asCashier();
    const order = await openOrder(api);
    await add(api, order.id, world.items.margherita.id);
    const before = await add(api, order.id, family.id);
    expect(before).toMatchObject({ total: '50.000', promotions: [], promoCode: null });

    const wrong = await api.put(`${ORDERS}/${order.id}/promo-code`, { code: 'NOPE1' });
    expect(messagesOf(wrong)).toEqual(['code:PROMO_CODE_INVALID']);

    const coded = orderOf(await api.put(`${ORDERS}/${order.id}/promo-code`, { code: 'welcome' }));
    expect(coded).toMatchObject({
      promoCode: 'WELCOME',
      promotionDiscount: '5.000',
      total: '45.000',
    });

    const removed = orderOf(await api.delete(`${ORDERS}/${order.id}/promo-code`));
    expect(removed).toMatchObject({ promoCode: null, promotionDiscount: '0.000', total: '50.000' });
  });

  it('come before the manual discount, which is a percentage of what is left (criterion 4)', async () => {
    const manager = await asPizzaManager();
    await addPromotion(manager, {
      kind: 'percent_off',
      value: '20',
      appliesTo: 'categories',
      categoryIds: [world.categories.drinks.id],
    });
    const order = await openOrder(manager);
    await add(manager, order.id, world.items.cola.id, 2);
    await add(manager, order.id, world.items.margherita.id);
    const discounted = orderOf(
      await manager.put(`${ORDERS}/${order.id}/discount`, {
        kind: 'percent',
        value: '10',
        reason: 'Regular customer',
      }),
    );
    expect(discounted).toMatchObject({
      subtotal: '30.000',
      promotionDiscount: '2.000',
      discount: { amount: '2.800' },
      total: '25.200',
    });
  });

  it('keep to their branches (criterion 5)', async () => {
    const manager = await asPizzaManager();
    await addPromotion(manager, { kind: 'amount_off', value: '1', branchIds: [world.mall.id] });
    const downtown = await openOrder(manager, world.downtown.id);
    expect((await add(manager, downtown.id, world.items.cola.id)).total).toBe('5.000');
    const mall = await openOrder(manager);
    expect((await add(manager, mall.id, world.items.cola.id)).total).toBe('4.000');
  });
});
