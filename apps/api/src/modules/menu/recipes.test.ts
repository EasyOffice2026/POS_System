import { randomUUID } from 'node:crypto';
import { type Order, orderSchema, type Recipe, recipeSchema } from '@pos/shared';
import type request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { openShift } from '../../../test/factories';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { createMenuWorld, type MenuWorld } from '../../../test/menu-world';
import { as, errorOf, signIn } from '../../../test/users-world';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const clock = new Date('2026-10-13T09:00:00Z');
const app = createApp({
  prisma,
  config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }),
  now: () => clock,
});

let world: MenuWorld;
let mozzarella: { id: string };
let extraCheese: { id: string };

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  world = await createMenuWorld(prisma, hasher);
  await openShift(prisma, world.users.cashier, world.mall);
  // Mozzarella at 3.000 KWD per kg; the Margherita uses 80 g and "extra cheese" 40 g more.
  mozzarella = await prisma.ingredient.create({
    data: {
      brandId: world.pizza.id,
      name: { en: 'Mozzarella', ar: 'موزاريلا' },
      searchText: 'mozzarella',
      unit: 'kg',
      costPerUnit: '3.000',
    },
  });
  const group = await prisma.modifierGroup.create({
    data: {
      brandId: world.pizza.id,
      itemId: world.items.margherita.id,
      name: { en: 'Extras', ar: 'إضافات' },
      minSelect: 0,
      maxSelect: 1,
    },
  });
  extraCheese = await prisma.modifier.create({
    data: {
      brandId: world.pizza.id,
      groupId: group.id,
      name: { en: 'Extra cheese', ar: 'جبنة إضافية' },
      priceDelta: '1.000',
    },
  });
});

type Api = ReturnType<typeof as>;
const MENU = '/api/v1/menu';
const ORDERS = '/api/v1/orders';
const itemRecipe = (id: string) => `${MENU}/items/${id}/recipe`;
const modifierRecipe = (id: string) => `${MENU}/modifiers/${id}/recipe`;

const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));
const asBurgerManager = async () => as(app, await signIn(app, 'burger@x.io'));
const asMallManager = async () => as(app, await signIn(app, 'mall-manager@x.io'));
const asCashier = async () => as(app, await signIn(app, 'cashier@x.io'));

const recipeOf = (res: request.Response): Recipe => recipeSchema.parse(res.body);
const orderOf = (res: request.Response): Order => orderSchema.parse(res.body);
const messagesOf = (res: request.Response) =>
  (errorOf(res).details ?? []).map((detail) => `${detail.path}:${detail.message}`);

async function setRecipes(api: Api) {
  const item = await api.put(itemRecipe(world.items.margherita.id), {
    lines: [{ ingredientId: mozzarella.id, quantity: '0.08' }],
  });
  expect(item.status).toBe(200);
  const modifier = await api.put(modifierRecipe(extraCheese.id), {
    lines: [{ ingredientId: mozzarella.id, quantity: '0.04' }],
  });
  expect(modifier.status).toBe(200);
}

const stockAtMall = () =>
  prisma.branchStock.findUnique({
    where: { branchId_ingredientId: { branchId: world.mall.id, ingredientId: mozzarella.id } },
  });

const movementsAtMall = () =>
  prisma.stockMovement.findMany({
    where: { branchId: world.mall.id },
    orderBy: { createdAt: 'asc' },
  });

async function payOrder(api: Api, lines: object[]) {
  const opened = orderOf(await api.post(ORDERS, { branchId: world.mall.id, type: 'takeaway' }));
  for (const line of lines) {
    const added = await api.post(`${ORDERS}/${opened.id}/lines`, line);
    expect(added.status).toBe(200);
  }
  const open = orderOf(await api.get(`${ORDERS}/${opened.id}`));
  const paid = await api.post(`${ORDERS}/${opened.id}/pay`, {
    tenders: [{ id: randomUUID(), method: 'cash', amount: open.total, tendered: open.total }],
  });
  expect(paid.status).toBe(200);
  return orderOf(paid);
}

describe('PUT /menu/items/:id/recipe', () => {
  it('stores the lines and works out the cost of the dish (criterion 4)', async () => {
    const api = await asPizzaManager();
    await setRecipes(api);

    const recipe = recipeOf(await api.get(itemRecipe(world.items.margherita.id)));
    expect(recipe.cost).toBe('0.240');
    expect(
      recipe.lines.map((line) => [
        line.ingredient.id,
        line.ingredient.unit,
        line.quantity,
        line.cost,
      ]),
    ).toEqual([[mozzarella.id, 'kg', '0.080', '0.240']]);
    expect(recipeOf(await api.get(modifierRecipe(extraCheese.id))).cost).toBe('0.120');
    await expect(
      prisma.auditLog.findMany({ where: { action: 'menu.recipe.updated' } }),
    ).resolves.toHaveLength(2);
  });

  it('replaces the recipe as a whole, and an empty one clears it', async () => {
    const api = await asPizzaManager();
    await setRecipes(api);

    const cleared = recipeOf(await api.put(itemRecipe(world.items.margherita.id), { lines: [] }));
    expect(cleared).toEqual({ lines: [], cost: '0.000' });
    await expect(
      prisma.recipeLine.count({ where: { itemId: world.items.margherita.id } }),
    ).resolves.toBe(0);
  });

  it('refuses the same ingredient twice (criterion 5)', async () => {
    const api = await asPizzaManager();
    const res = await api.put(itemRecipe(world.items.margherita.id), {
      lines: [
        { ingredientId: mozzarella.id, quantity: '0.08' },
        { ingredientId: mozzarella.id, quantity: '0.02' },
      ],
    });
    expect(res.status).toBe(400);
    expect(messagesOf(res)).toEqual(['lines:INGREDIENT_DUPLICATE']);
  });

  it('refuses an ingredient of another brand, and names the line', async () => {
    const api = await asBurgerManager();
    const res = await api.put(itemRecipe(world.items.cheeseburger.id), {
      lines: [{ ingredientId: mozzarella.id, quantity: '0.05' }],
    });
    expect(res.status).toBe(400);
    expect(messagesOf(res)).toEqual(['lines.0.ingredientId:INGREDIENT_NOT_FOUND']);
  });

  it('is hidden from the manager of another brand (criterion 6)', async () => {
    const pizza = await asPizzaManager();
    expect((await pizza.get(itemRecipe(world.items.cheeseburger.id))).status).toBe(404);
    expect((await pizza.put(itemRecipe(world.items.cheeseburger.id), { lines: [] })).status).toBe(
      404,
    );
  });

  it('can be read by a branch manager but not written, and not read by a cashier', async () => {
    const manager = await asMallManager();
    expect((await manager.get(itemRecipe(world.items.margherita.id))).status).toBe(200);
    expect((await manager.put(itemRecipe(world.items.margherita.id), { lines: [] })).status).toBe(
      403,
    );
    const cashier = await asCashier();
    expect((await cashier.get(itemRecipe(world.items.margherita.id))).status).toBe(403);
  });
});

describe('paying an order', () => {
  it('takes the ingredients of the dishes and their modifiers off the stock (criterion 1)', async () => {
    await setRecipes(await asPizzaManager());
    const api = await asCashier();
    const paid = await payOrder(api, [
      {
        kind: 'item',
        itemId: world.items.margherita.id,
        quantity: 2,
        modifierIds: [extraCheese.id],
      },
      { kind: 'item', itemId: world.items.cola.id },
    ]);

    expect((await stockAtMall())?.quantity.toFixed(3)).toBe('-0.240');
    const movements = await movementsAtMall();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      ingredientId: mozzarella.id,
      kind: 'sold',
      referenceId: paid.id,
      note: `Order ${paid.number}`,
      byId: world.users.cashier.id,
      createdAt: clock,
    });
    expect(movements[0]?.quantity.toFixed(3)).toBe('-0.240');
    expect(movements[0]?.quantityAfter.toFixed(3)).toBe('-0.240');
  });

  it('takes the stock off when the kitchen starts the ticket instead, if the brand says so', async () => {
    await prisma.brand.update({
      where: { id: world.pizza.id },
      data: { settings: { stockDeductAt: 'preparing' } },
    });
    await setRecipes(await asPizzaManager());
    const api = await asCashier();
    const opened = orderOf(await api.post(ORDERS, { branchId: world.mall.id, type: 'dine_in' }));
    await api.post(`${ORDERS}/${opened.id}/lines`, {
      kind: 'item',
      itemId: world.items.margherita.id,
      quantity: 2,
      modifierIds: [extraCheese.id],
    });
    expect((await api.post(`${ORDERS}/${opened.id}/send`)).status).toBe(200);
    // Sent, nothing moves yet.
    expect(await stockAtMall()).toBeNull();

    const kitchen = await asMallManager();
    const tickets = (
      (await kitchen.get(`/api/v1/kitchen/tickets?branchId=${world.mall.id}`)).body as {
        data: { id: string }[];
      }
    ).data;
    const ticketId = tickets[0]?.id ?? '';
    const started = await kitchen.patch(`/api/v1/kitchen/tickets/${ticketId}`, {
      from: 'new',
      to: 'preparing',
    });
    expect(started.status).toBe(200);
    expect((await stockAtMall())?.quantity.toFixed(3)).toBe('-0.240');
    const movements = await movementsAtMall();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      kind: 'sold',
      referenceId: opened.id,
      byId: world.users.mallManager.id,
      byName: world.users.mallManager.name,
    });

    // Moving on, and paying, take nothing off a second time.
    await kitchen.patch(`/api/v1/kitchen/tickets/${ticketId}`, { from: 'preparing', to: 'ready' });
    const open = orderOf(await api.get(`${ORDERS}/${opened.id}`));
    const paid = await api.post(`${ORDERS}/${opened.id}/pay`, {
      tenders: [{ id: randomUUID(), method: 'cash', amount: open.total, tendered: open.total }],
    });
    expect(paid.status).toBe(200);
    expect((await stockAtMall())?.quantity.toFixed(3)).toBe('-0.240');
    expect(await movementsAtMall()).toHaveLength(1);
  });

  it('takes it off at payment at a branch without a kitchen screen (spec 027, rule 3)', async () => {
    await prisma.brand.update({
      where: { id: world.pizza.id },
      data: { settings: { stockDeductAt: 'preparing' } },
    });
    const mall = await prisma.branch.findUniqueOrThrow({ where: { id: world.mall.id } });
    await prisma.branch.update({
      where: { id: world.mall.id },
      data: {
        config: {
          ...(mall.config as object),
          kitchen: { screen: false, slip: false },
        },
      },
    });
    await setRecipes(await asPizzaManager());
    const api = await asCashier();
    const opened = orderOf(await api.post(ORDERS, { branchId: world.mall.id, type: 'dine_in' }));
    await api.post(`${ORDERS}/${opened.id}/lines`, {
      kind: 'item',
      itemId: world.items.margherita.id,
      quantity: 2,
      modifierIds: [extraCheese.id],
    });
    const sent = orderOf(await api.post(`${ORDERS}/${opened.id}/send`));
    // Sent from the slip: no ticket waits on a screen.
    expect(sent.lines.map((line) => [line.status, line.ticketId])).toEqual([['sent', null]]);
    await expect(prisma.kitchenTicket.count()).resolves.toBe(0);
    expect(await stockAtMall()).toBeNull();

    const paid = await api.post(`${ORDERS}/${opened.id}/pay`, {
      tenders: [{ id: randomUUID(), method: 'cash', amount: sent.total, tendered: sent.total }],
    });
    expect(paid.status).toBe(200);
    expect((await stockAtMall())?.quantity.toFixed(3)).toBe('-0.240');
    expect(await movementsAtMall()).toHaveLength(1);
  });

  it('uses the recipes of the dishes chosen in a combo (criterion 2)', async () => {
    await setRecipes(await asPizzaManager());
    const combo = await prisma.combo.create({
      data: { brandId: world.pizza.id, name: { en: 'Meal', ar: 'وجبة' }, price: '24.000' },
    });
    const slot = await prisma.comboSlot.create({
      data: { brandId: world.pizza.id, comboId: combo.id, name: { en: 'Pizza', ar: 'بيتزا' } },
    });
    await prisma.comboSlotOption.create({
      data: { slotId: slot.id, itemId: world.items.margherita.id, brandId: world.pizza.id },
    });
    const api = await asCashier();
    await payOrder(api, [
      {
        kind: 'combo',
        comboId: combo.id,
        choices: [{ slotId: slot.id, itemId: world.items.margherita.id }],
      },
    ]);

    expect((await stockAtMall())?.quantity.toFixed(3)).toBe('-0.080');
  });

  it('goes below zero and still goes through (criterion 3)', async () => {
    await setRecipes(await asPizzaManager());
    await prisma.branchStock.create({
      data: {
        brandId: world.pizza.id,
        branchId: world.mall.id,
        ingredientId: mozzarella.id,
        quantity: '0.100',
      },
    });
    const api = await asCashier();
    const paid = await payOrder(api, [
      {
        kind: 'item',
        itemId: world.items.margherita.id,
        quantity: 2,
        modifierIds: [extraCheese.id],
      },
    ]);

    expect(paid.status).toBe('paid');
    expect((await stockAtMall())?.quantity.toFixed(3)).toBe('-0.140');
    expect((await movementsAtMall())[0]?.quantityAfter.toFixed(3)).toBe('-0.140');
  });

  it('takes nothing off for a dish without a recipe, or a voided line', async () => {
    await setRecipes(await asPizzaManager());
    const api = await asCashier();
    const opened = orderOf(await api.post(ORDERS, { branchId: world.mall.id, type: 'takeaway' }));
    const added = orderOf(
      await api.post(`${ORDERS}/${opened.id}/lines`, {
        kind: 'item',
        itemId: world.items.margherita.id,
      }),
    );
    await prisma.orderLine.update({
      where: { id: added.lines[0]?.id },
      data: { status: 'voided', voidedAt: clock, voidReason: 'Wrong pizza' },
    });
    await api.post(`${ORDERS}/${opened.id}/lines`, { kind: 'item', itemId: world.items.cola.id });
    const open = orderOf(await api.get(`${ORDERS}/${opened.id}`));
    const paid = await api.post(`${ORDERS}/${opened.id}/pay`, {
      tenders: [{ id: randomUUID(), method: 'cash', amount: open.total, tendered: open.total }],
    });
    expect(paid.status).toBe(200);

    expect(await stockAtMall()).toBeNull();
    expect(await movementsAtMall()).toEqual([]);
  });
});
