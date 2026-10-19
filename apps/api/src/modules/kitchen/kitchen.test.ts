import {
  type KitchenTicket,
  kitchenTicketListSchema,
  kitchenTicketSchema,
  type Order,
  orderSchema,
} from '@pos/shared';
import type request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { createUser, openShift } from '../../../test/factories';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { createMenuWorld, type MenuWorld } from '../../../test/menu-world';
import { as, errorOf, signIn } from '../../../test/users-world';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
let clock = new Date('2026-10-13T09:00:00Z');
const app = createApp({
  prisma,
  config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }),
  now: () => clock,
});

let world: MenuWorld;

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  clock = new Date('2026-10-13T09:00:00Z');
  await resetDatabase(prisma);
  world = await createMenuWorld(prisma, hasher);
  await openShift(prisma, world.users.cashier, world.mall);
  await createUser(prisma, hasher, {
    roleKey: 'kitchen',
    name: 'Karim Kitchen',
    brandId: world.pizza.id,
    branchIds: [world.mall.id],
    email: 'kitchen@x.io',
  });
});

type Api = ReturnType<typeof as>;
const ORDERS = '/api/v1/orders';
const TICKETS = '/api/v1/kitchen/tickets';
const asCashier = async () => as(app, await signIn(app, 'cashier@x.io'));
const asKitchen = async () => as(app, await signIn(app, 'kitchen@x.io'));
const asMallManager = async () => as(app, await signIn(app, 'mall-manager@x.io'));
const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));

const orderOf = (res: request.Response): Order => orderSchema.parse(res.body);
const ticketsOf = (res: request.Response) => kitchenTicketListSchema.parse(res.body).data;

// An order at a branch with the dishes given, sent to the kitchen.
async function sentOrder(api: Api, itemIds: string[], branchId = world.mall.id) {
  const order = orderOf(await api.post(ORDERS, { branchId, type: 'dine_in' }));
  for (const itemId of itemIds) {
    await api.post(`${ORDERS}/${order.id}/lines`, { kind: 'item', itemId });
  }
  return orderOf(await api.post(`${ORDERS}/${order.id}/send`));
}

const kitchenAt = async (api: Api, branchId = world.mall.id) =>
  ticketsOf(await api.get(`${TICKETS}?branchId=${branchId}`));

const move = (api: Api, ticket: KitchenTicket, from: string, to: string) =>
  api.patch(`${TICKETS}/${ticket.id}`, { from, to });

async function onlyTicket(api: Api): Promise<KitchenTicket> {
  const [ticket, ...rest] = await kitchenAt(api);
  expect(rest).toEqual([]);
  if (!ticket) throw new Error('The kitchen has no ticket');
  return ticket;
}

describe('GET /kitchen/tickets', () => {
  it('shows one new ticket per send with its dishes (criterion 1)', async () => {
    const cashier = await asCashier();
    const order = await sentOrder(cashier, [world.items.margherita.id, world.items.cola.id]);

    const ticket = await onlyTicket(await asKitchen());
    expect(ticket).toMatchObject({
      orderId: order.id,
      orderNumber: 1,
      orderType: 'dine_in',
      status: 'new',
      sentAt: clock.toISOString(),
      startedAt: null,
    });
    expect(ticket.lines.map((line) => [line.name.en, line.quantity, line.voided])).toEqual([
      ['Margherita', 1, false],
      ['Cola', 1, false],
    ]);
  });

  it('makes a new ticket for what is added and sent later, and for what payment sends', async () => {
    const cashier = await asCashier();
    const order = await sentOrder(cashier, [world.items.margherita.id]);
    clock = new Date('2026-10-13T09:05:00Z');
    await cashier.post(`${ORDERS}/${order.id}/lines`, {
      kind: 'item',
      itemId: world.items.cola.id,
    });
    await cashier.post(`${ORDERS}/${order.id}/send`);
    clock = new Date('2026-10-13T09:07:00Z');
    const paid = orderOf(
      await cashier.post(`${ORDERS}/${order.id}/lines`, {
        kind: 'item',
        itemId: world.items.pepperoni.id,
      }),
    );
    await cashier.post(`${ORDERS}/${order.id}/pay`, {
      tenders: [
        {
          id: '01990000-0000-7000-8000-000000000999',
          method: 'knet',
          amount: paid.total,
          reference: 'K1',
        },
      ],
    });

    const tickets = await kitchenAt(await asKitchen());
    expect(
      tickets.map((ticket) => [ticket.sentAt, ticket.lines.map((line) => line.name.en)]),
    ).toEqual([
      ['2026-10-13T09:00:00.000Z', ['Margherita']],
      ['2026-10-13T09:05:00.000Z', ['Cola']],
      ['2026-10-13T09:07:00.000Z', ['Pepperoni']],
    ]);
  });

  it('shows a dish voided after it was sent as voided (criterion 4)', async () => {
    const cashier = await asCashier();
    const order = await sentOrder(cashier, [world.items.margherita.id, world.items.cola.id]);
    const cola = order.lines[1];
    if (!cola) throw new Error('The order has two lines');
    await (
      await asMallManager()
    ).post(`${ORDERS}/${order.id}/lines/${cola.id}/void`, {
      reason: 'Wrong item',
    });

    const kitchen = await asKitchen();
    expect((await onlyTicket(kitchen)).lines.map((line) => line.voided)).toEqual([false, true]);

    await (await asMallManager()).post(`${ORDERS}/${order.id}/void`, { reason: 'Customer left' });
    expect((await onlyTicket(kitchen)).lines.map((line) => line.voided)).toEqual([true, true]);
  });

  it('never shows a kitchen the tickets of another branch (criterion 7)', async () => {
    await sentOrder(await asPizzaManager(), [world.items.cola.id], world.downtown.id);

    const kitchen = await asKitchen();
    expect(await kitchenAt(kitchen)).toEqual([]);
    const other = await kitchen.get(`${TICKETS}?branchId=${world.downtown.id}`);
    expect(other.status).toBe(404);
  });

  it('needs a branch', async () => {
    const res = await (await asKitchen()).get(TICKETS);
    expect(res.status).toBe(400);
    expect(errorOf(res).details?.map((detail) => detail.message)).toEqual(['BRANCH_REQUIRED']);
  });
});

describe('PATCH /kitchen/tickets/:id', () => {
  it('moves a ticket to preparing and ready, which the POS shows (criterion 2)', async () => {
    const cashier = await asCashier();
    const order = await sentOrder(cashier, [world.items.margherita.id]);
    const kitchen = await asKitchen();
    const ticket = await onlyTicket(kitchen);

    clock = new Date('2026-10-13T09:02:00Z');
    const started = await move(kitchen, ticket, 'new', 'preparing');
    expect(started.status).toBe(200);
    expect(kitchenTicketSchema.parse(started.body)).toMatchObject({
      status: 'preparing',
      startedAt: clock.toISOString(),
    });
    expect(orderOf(await cashier.get(`${ORDERS}/${order.id}`)).lines[0]?.kitchenStatus).toBe(
      'preparing',
    );

    clock = new Date('2026-10-13T09:09:00Z');
    await move(kitchen, ticket, 'preparing', 'ready');
    const seen = orderOf(await cashier.get(`${ORDERS}/${order.id}`));
    expect(seen.lines[0]?.kitchenStatus).toBe('ready');
  });

  it('tells the second of two screens that the ticket changed (criterion 3)', async () => {
    await sentOrder(await asCashier(), [world.items.cola.id]);
    const first = await asKitchen();
    const second = await asMallManager();
    const ticket = await onlyTicket(first);

    expect((await move(first, ticket, 'new', 'preparing')).status).toBe(200);
    const late = await move(second, ticket, 'new', 'preparing');
    expect(late.status).toBe(409);
    expect(errorOf(late).code).toBe('TICKET_CHANGED');
  });

  it('finishes a ticket and recalls it (criterion 5)', async () => {
    await sentOrder(await asCashier(), [world.items.cola.id]);
    const kitchen = await asKitchen();
    const ticket = await onlyTicket(kitchen);

    await move(kitchen, ticket, 'new', 'ready');
    clock = new Date('2026-10-13T09:04:00Z');
    const done = kitchenTicketSchema.parse((await move(kitchen, ticket, 'ready', 'done')).body);
    expect(done).toMatchObject({ status: 'done', doneAt: clock.toISOString() });
    expect((await onlyTicket(kitchen)).status).toBe('done');

    const recalled = kitchenTicketSchema.parse((await move(kitchen, ticket, 'done', 'ready')).body);
    expect(recalled).toMatchObject({ status: 'ready', doneAt: null });
  });

  it('lets a cashier look but not move (criterion 6)', async () => {
    const cashier = await asCashier();
    await sentOrder(cashier, [world.items.cola.id]);
    const ticket = await onlyTicket(cashier);

    const res = await move(cashier, ticket, 'new', 'preparing');
    expect(res.status).toBe(403);
  });

  it('refuses a move that skips ahead', async () => {
    await sentOrder(await asCashier(), [world.items.cola.id]);
    const kitchen = await asKitchen();
    const ticket = await onlyTicket(kitchen);

    const res = await move(kitchen, ticket, 'new', 'done');
    expect(res.status).toBe(400);
    expect(errorOf(res).details?.map((detail) => detail.message)).toEqual([
      'TICKET_STATUS_INVALID',
    ]);
  });

  it('answers 404 for a ticket of another branch', async () => {
    await sentOrder(await asPizzaManager(), [world.items.cola.id], world.downtown.id);
    const [ticket] = await kitchenAt(await asPizzaManager(), world.downtown.id);
    if (!ticket) throw new Error('Downtown has a ticket');

    const res = await move(await asKitchen(), ticket, 'new', 'preparing');
    expect(res.status).toBe(404);
    const stored = await prisma.kitchenTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.status).toBe('new');
  });
});
