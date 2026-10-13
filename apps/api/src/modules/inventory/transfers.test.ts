import { pageSchema, type StockTransfer, stockTransferSchema } from '@pos/shared';
import type request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../app';
import { createUser } from '../../../test/factories';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { as, createUsersWorld, errorOf, signIn, type UsersWorld } from '../../../test/users-world';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const clock = new Date('2026-10-14T09:00:00Z');
const app = createApp({
  prisma,
  config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }),
  now: () => clock,
});

let world: UsersWorld;
let mozzarella: { id: string };

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  world = await createUsersWorld(prisma, hasher);
  await createUser(prisma, hasher, {
    roleKey: 'branch_manager',
    name: 'Dina Downtown Manager',
    brandId: world.pizza.id,
    branchIds: [world.downtown.id],
    email: 'downtown-manager@x.io',
  });
  mozzarella = await prisma.ingredient.create({
    data: {
      brandId: world.pizza.id,
      name: { en: 'Mozzarella', ar: 'موزاريلا' },
      searchText: 'mozzarella',
      unit: 'kg',
      costPerUnit: '3.000',
    },
  });
});

type Api = ReturnType<typeof as>;
const TRANSFERS = '/api/v1/inventory/transfers';
const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));
const asBurgerManager = async () => as(app, await signIn(app, 'burger@x.io'));
const asMallManager = async () => as(app, await signIn(app, 'mall-manager@x.io'));
const asDowntownManager = async () => as(app, await signIn(app, 'downtown-manager@x.io'));

const transferOf = (res: request.Response): StockTransfer => stockTransferSchema.parse(res.body);
const messagesOf = (res: request.Response) =>
  (errorOf(res).details ?? []).map((detail) => `${detail.path}:${detail.message}`);

const stockAt = async (branchId: string) =>
  (
    await prisma.branchStock.findUnique({
      where: { branchId_ingredientId: { branchId, ingredientId: mozzarella.id } },
    })
  )?.quantity.toFixed(3) ?? null;

const movementsAt = (branchId: string) =>
  prisma.stockMovement.findMany({
    where: { branchId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

async function stockDowntown(quantity: string) {
  await prisma.branchStock.create({
    data: {
      brandId: world.pizza.id,
      branchId: world.downtown.id,
      ingredientId: mozzarella.id,
      quantity,
    },
  });
}

const send = (api: Api, quantity = '2', extra: object = {}) =>
  api.post(TRANSFERS, {
    fromBranchId: world.downtown.id,
    toBranchId: world.mall.id,
    lines: [{ ingredientId: mozzarella.id, quantity }],
    ...extra,
  });

async function sentTransfer(api: Api) {
  await stockDowntown('5');
  const res = await send(api, '2', { note: 'For the weekend' });
  expect(res.status).toBe(201);
  return transferOf(res);
}

describe('POST /inventory/transfers', () => {
  it('takes the stock off the sender and leaves the receiver as it is (criterion 1)', async () => {
    const transfer = await sentTransfer(await asDowntownManager());

    expect(transfer).toMatchObject({
      status: 'sent',
      note: 'For the weekend',
      fromBranch: { id: world.downtown.id, name: { en: 'Pizza Downtown' } },
      toBranch: { id: world.mall.id },
      sentByName: 'Dina Downtown Manager',
      sentAt: clock.toISOString(),
      receivedAt: null,
      cancelledAt: null,
    });
    expect(transfer.number).toBeGreaterThan(0);
    expect(transfer.lines.map((line) => [line.ingredient.id, line.quantity])).toEqual([
      [mozzarella.id, '2.000'],
    ]);
    expect(await stockAt(world.downtown.id)).toBe('3.000');
    expect(await stockAt(world.mall.id)).toBeNull();
    const [out] = await movementsAt(world.downtown.id);
    expect(out).toMatchObject({
      kind: 'transfer_out',
      referenceId: transfer.id,
      note: `Transfer ${transfer.number}`,
      byName: 'Dina Downtown Manager',
    });
    expect(out?.quantity.toFixed(3)).toBe('-2.000');
    expect(out?.quantityAfter.toFixed(3)).toBe('3.000');
    await expect(
      prisma.auditLog.findMany({ where: { action: 'stock_transfer.sent' } }),
    ).resolves.toHaveLength(1);
  });

  it('refuses to send more than there is, and writes nothing (criterion 4)', async () => {
    await stockDowntown('1');
    const res = await send(await asDowntownManager(), '2');
    expect(res.status).toBe(400);
    expect(messagesOf(res)).toEqual(['lines.0.quantity:STOCK_NEGATIVE']);
    expect(await stockAt(world.downtown.id)).toBe('1.000');
    await expect(prisma.stockTransfer.count()).resolves.toBe(0);
    await expect(prisma.stockMovement.count()).resolves.toBe(0);
  });

  it('refuses the same branch, a branch of another brand and an unknown ingredient', async () => {
    const api = await asPizzaManager();
    await stockDowntown('5');
    expect(messagesOf(await send(api, '1', { toBranchId: world.downtown.id }))).toEqual([
      'toBranchId:TRANSFER_SAME_BRANCH',
    ]);
    expect(messagesOf(await send(api, '1', { toBranchId: world.airport.id }))).toEqual([
      'toBranchId:BRANCH_NOT_FOUND',
    ]);
    expect(
      messagesOf(
        await send(api, '1', {
          lines: [{ ingredientId: '01990000-0000-7000-8000-000000009999', quantity: '1' }],
        }),
      ),
    ).toEqual(['lines.0.ingredientId:INGREDIENT_NOT_FOUND']);
  });

  it('is only sent from a branch the person works at (criterion 5)', async () => {
    await stockDowntown('5');
    const res = await send(await asMallManager(), '1');
    expect(res.status).toBe(404);
  });

  it('is never between the branches of another brand (criterion 6)', async () => {
    await stockDowntown('5');
    const res = await send(await asBurgerManager(), '1');
    expect(res.status).toBe(404);
    const list = await (await asBurgerManager()).get(`${TRANSFERS}?branchId=${world.mall.id}`);
    expect(list.status).toBe(404);
  });
});

describe('receiving and cancelling', () => {
  it('adds the stock at the receiver when the receiver takes it in (criterion 2)', async () => {
    const transfer = await sentTransfer(await asDowntownManager());
    const mall = await asMallManager();

    const res = await mall.post(`${TRANSFERS}/${transfer.id}/receive`, {});
    expect(res.status).toBe(200);
    expect(transferOf(res)).toMatchObject({
      status: 'received',
      receivedByName: 'Maha Mall Manager',
      receivedAt: clock.toISOString(),
    });
    expect(await stockAt(world.mall.id)).toBe('2.000');
    expect(await stockAt(world.downtown.id)).toBe('3.000');
    const [into] = await movementsAt(world.mall.id);
    expect(into).toMatchObject({ kind: 'transfer_in', referenceId: transfer.id });
    expect(into?.quantity.toFixed(3)).toBe('2.000');
    await expect(
      prisma.auditLog.findMany({ where: { action: 'stock_transfer.received' } }),
    ).resolves.toHaveLength(1);
  });

  it('puts the stock back at the sender when the sender cancels it (criterion 3)', async () => {
    const downtown = await asDowntownManager();
    const transfer = await sentTransfer(downtown);

    const noReason = await downtown.post(`${TRANSFERS}/${transfer.id}/cancel`, { reason: ' ' });
    expect(messagesOf(noReason)).toEqual(['reason:NOTE_REQUIRED']);

    const res = await downtown.post(`${TRANSFERS}/${transfer.id}/cancel`, {
      reason: 'Sent by mistake',
    });
    expect(res.status).toBe(200);
    expect(transferOf(res)).toMatchObject({
      status: 'cancelled',
      cancelledByName: 'Dina Downtown Manager',
      cancelReason: 'Sent by mistake',
    });
    expect(await stockAt(world.downtown.id)).toBe('5.000');
    const movements = await movementsAt(world.downtown.id);
    expect(movements.map((movement) => movement.kind)).toEqual(['transfer_out', 'transfer_in']);
    expect(movements[1]?.note).toBe(`Transfer ${transfer.number} cancelled: Sent by mistake`);

    const late = await (await asMallManager()).post(`${TRANSFERS}/${transfer.id}/receive`, {});
    expect(late.status).toBe(409);
    expect(errorOf(late).code).toBe('TRANSFER_NOT_SENT');
    expect(await stockAt(world.mall.id)).toBeNull();
  });

  it('cannot be received twice', async () => {
    const transfer = await sentTransfer(await asDowntownManager());
    const mall = await asMallManager();
    await mall.post(`${TRANSFERS}/${transfer.id}/receive`, {});
    const again = await mall.post(`${TRANSFERS}/${transfer.id}/receive`, {});
    expect(again.status).toBe(409);
    expect(await stockAt(world.mall.id)).toBe('2.000');
  });

  it('lets the receiver see and receive, not cancel, and the sender cancel, not receive (criterion 5)', async () => {
    const downtown = await asDowntownManager();
    const transfer = await sentTransfer(downtown);
    const mall = await asMallManager();

    const seen = z
      .object({ data: z.array(stockTransferSchema) })
      .parse((await mall.get(`${TRANSFERS}?branchId=${world.mall.id}`)).body);
    expect(seen.data.map((row) => row.id)).toEqual([transfer.id]);
    expect((await mall.get(`${TRANSFERS}/${transfer.id}`)).status).toBe(200);
    expect((await mall.post(`${TRANSFERS}/${transfer.id}/cancel`, { reason: 'No' })).status).toBe(
      403,
    );
    expect((await downtown.post(`${TRANSFERS}/${transfer.id}/receive`, {})).status).toBe(403);

    const sentOnly = pageSchema(stockTransferSchema).parse(
      (await downtown.get(`${TRANSFERS}?branchId=${world.downtown.id}&status=received`)).body,
    );
    expect(sentOnly.data).toEqual([]);
  });

  it('lists the other branches of the brand to send to, even for a branch manager', async () => {
    const res = await (
      await asMallManager()
    ).get(`${TRANSFERS}/destinations?branchId=${world.mall.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [{ id: world.downtown.id, name: { en: 'Pizza Downtown', ar: 'Pizza Downtown (ar)' } }],
    });
  });
});
