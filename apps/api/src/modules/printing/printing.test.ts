import {
  type BranchMenu,
  bridgePrintJobSchema,
  printBridgeInfoSchema,
  printBridgeKeySchema,
  printJobSchema,
} from '@pos/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { createMenuWorld, type MenuWorld } from '../../../test/menu-world';
import { as, errorOf, signIn } from '../../../test/users-world';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
let clock = new Date('2026-11-01T09:00:00Z');
const app = createApp({
  prisma,
  // A claim answers at once when there is nothing, so the tests do not wait.
  config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000', PRINT_BRIDGE_WAIT_SECONDS: '0' }),
  now: () => clock,
});

let world: MenuWorld;

const receiptPrinter = {
  id: '01990000-0000-7000-8000-0000000000a1',
  name: 'Cash desk',
  kind: 'receipt',
  host: '192.168.1.50',
  port: 9100,
};
const kitchenPrinter = {
  id: '01990000-0000-7000-8000-0000000000a2',
  name: 'Pizza oven',
  kind: 'kitchen',
  host: 'oven.local',
  port: 9101,
};

// A PNG as far as the API looks: its signature, then anything.
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('picture'),
]).toString('base64');

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  clock = new Date('2026-11-01T09:00:00Z');
  await resetDatabase(prisma);
  world = await createMenuWorld(prisma, hasher);
  await prisma.branch.update({
    where: { id: world.mall.id },
    data: { config: { printers: [receiptPrinter, kitchenPrinter] } },
  });
});

const JOBS = '/api/v1/print-jobs';
const BRIDGE = '/api/v1/print-bridge';
const keyPath = (branchId: string) => `/api/v1/branches/${branchId}/print-bridge-key`;

const asCashier = async () => as(app, await signIn(app, 'cashier@x.io'));
const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));
const asMallManager = async () => as(app, await signIn(app, 'mall-manager@x.io'));
const asBurgerManager = async () => as(app, await signIn(app, 'burger@x.io'));

// Calls the API as a print bridge.
function asBridge(key: string) {
  const bearer = `Bearer ${key}`;
  return {
    get: (path: string) => request(app).get(path).set('Authorization', bearer),
    post: (path: string, body?: object) =>
      request(app).post(path).set('Authorization', bearer).send(body),
  };
}

async function bridgeKey(branchId = world.mall.id): Promise<string> {
  const manager = await asPizzaManager();
  const res = await manager.post(keyPath(branchId));
  expect(res.status).toBe(201);
  return printBridgeKeySchema.parse(res.body).key;
}

async function leaveJob(kind = 'receipt', printerId = receiptPrinter.id) {
  const cashier = await asCashier();
  const res = await cashier.post(JOBS, {
    branchId: world.mall.id,
    printerId,
    kind,
    orderNumber: 7,
    image: png,
  });
  expect(res.status).toBe(201);
  return printJobSchema.parse(res.body);
}

describe('POST /print-jobs', () => {
  it('leaves a receipt for the receipt printer of the branch, queued (rule 2)', async () => {
    const job = await leaveJob();

    expect(job).toMatchObject({
      branchId: world.mall.id,
      printerId: receiptPrinter.id,
      printerName: 'Cash desk',
      kind: 'receipt',
      status: 'queued',
      orderNumber: 7,
      attempts: 0,
      error: null,
      finishedAt: null,
    });
    const stored = await prisma.printJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(Buffer.from(stored.image).toString('base64')).toBe(png);
    expect(stored.createdById).toBe(world.users.cashier.id);

    const cashier = await asCashier();
    const read = await cashier.get(`${JOBS}/${job.id}`);
    expect(read.status).toBe(200);
    expect(printJobSchema.parse(read.body)).toEqual(job);
  });

  it('refuses a printer of the wrong kind, an unknown printer, and a picture that is not a PNG', async () => {
    const cashier = await asCashier();
    const body = { branchId: world.mall.id, printerId: receiptPrinter.id, image: png };

    const wrongKind = await cashier.post(JOBS, { ...body, kind: 'kitchen' });
    expect(wrongKind.status).toBe(404);

    const unknown = await cashier.post(JOBS, {
      ...body,
      kind: 'receipt',
      printerId: '01990000-0000-7000-8000-0000000000ff',
    });
    expect(unknown.status).toBe(404);

    const notPng = await cashier.post(JOBS, {
      ...body,
      kind: 'receipt',
      image: Buffer.from('hello').toString('base64'),
    });
    expect(notPng.status).toBe(400);
    expect(errorOf(notPng).details).toEqual([{ path: 'image', message: 'PRINT_IMAGE_INVALID' }]);
  });

  it('keeps a cashier to the printers of their own branch', async () => {
    await prisma.branch.update({
      where: { id: world.downtown.id },
      data: {
        config: { printers: [{ ...receiptPrinter, id: '01990000-0000-7000-8000-0000000000b1' }] },
      },
    });
    const cashier = await asCashier();

    const res = await cashier.post(JOBS, {
      branchId: world.downtown.id,
      printerId: '01990000-0000-7000-8000-0000000000b1',
      kind: 'receipt',
      image: png,
    });

    expect(res.status).toBe(404);
  });

  it('tells the till which printers the branch has, without their addresses', async () => {
    const cashier = await asCashier();

    const res = await cashier.get(`/api/v1/menu?branchId=${world.mall.id}`);

    expect(res.status).toBe(200);
    expect((res.body as BranchMenu).printers).toEqual([
      { id: receiptPrinter.id, name: 'Cash desk', kind: 'receipt' },
      { id: kitchenPrinter.id, name: 'Pizza oven', kind: 'kitchen' },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('192.168.1.50');
  });
});

describe('the bridge key (rule 4)', () => {
  it('is made by a brand manager, shown once, and replaced by the next one', async () => {
    const manager = await asPizzaManager();
    expect((await manager.get(keyPath(world.mall.id))).body).toEqual({ createdAt: null });

    const first = await bridgeKey();
    expect(first).toMatch(/^pb_[A-Za-z0-9_-]{40,}$/);
    expect((await manager.get(keyPath(world.mall.id))).body).toEqual({
      createdAt: '2026-11-01T09:00:00.000Z',
    });
    const rows = await prisma.printBridgeKey.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.keyHash).not.toContain(first.slice(3, 20));
    expect(
      await prisma.auditLog.count({ where: { action: 'branch.print_bridge_key_created' } }),
    ).toBe(1);

    expect((await asBridge(first).get(BRIDGE)).status).toBe(200);
    clock = new Date('2026-11-01T10:00:00Z');
    const second = await bridgeKey();
    expect((await asBridge(first).get(BRIDGE)).status).toBe(401);
    expect((await asBridge(second).get(BRIDGE)).status).toBe(200);
    expect(await prisma.printBridgeKey.count()).toBe(1);
  });

  it('needs branches:write, and only for a branch of the brand', async () => {
    const mallManager = await asMallManager();
    expect((await mallManager.post(keyPath(world.mall.id))).status).toBe(403);

    const burger = await asBurgerManager();
    expect((await burger.post(keyPath(world.mall.id))).status).toBe(404);
    expect((await burger.get(keyPath(world.mall.id))).status).toBe(404);
  });
});

describe('the bridge (rule 3)', () => {
  it('is refused without a key, with a wrong key, and at a branch that is not active', async () => {
    expect((await request(app).get(BRIDGE)).status).toBe(401);
    expect((await asBridge('pb_not-a-key').get(BRIDGE)).status).toBe(401);
    expect((await asBridge('nothing').post(`${BRIDGE}/jobs/claim`)).status).toBe(401);

    const key = await bridgeKey();
    await prisma.branch.update({ where: { id: world.mall.id }, data: { isActive: false } });
    const res = await asBridge(key).get(BRIDGE);
    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe('BRANCH_INACTIVE');
  });

  it('learns its branch and printers when it starts', async () => {
    const bridge = asBridge(await bridgeKey());

    const res = await bridge.get(BRIDGE);

    expect(res.status).toBe(200);
    expect(printBridgeInfoSchema.parse(res.body)).toEqual({
      branchId: world.mall.id,
      branchName: { en: 'Pizza Mall', ar: 'Pizza Mall (ar)' },
      printers: [receiptPrinter, kitchenPrinter],
    });
  });

  it('takes the oldest job with its picture and the printer address, then reports it printed', async () => {
    const first = await leaveJob();
    clock = new Date('2026-11-01T09:00:05Z');
    const second = await leaveJob('kitchen', kitchenPrinter.id);
    const bridge = asBridge(await bridgeKey());

    const claim = await bridge.post(`${BRIDGE}/jobs/claim`);
    expect(claim.status).toBe(200);
    const job = bridgePrintJobSchema.parse(claim.body);
    expect(job).toMatchObject({
      id: first.id,
      status: 'printing',
      attempts: 1,
      image: png,
      printer: { host: '192.168.1.50', port: 9100 },
    });

    // The second job is next, and after that there is nothing.
    const next = await bridge.post(`${BRIDGE}/jobs/claim`);
    expect(next.status).toBe(200);
    expect(bridgePrintJobSchema.parse(next.body)).toMatchObject({
      id: second.id,
      printer: { host: 'oven.local', port: 9101 },
    });
    expect((await bridge.post(`${BRIDGE}/jobs/claim`)).status).toBe(204);

    clock = new Date('2026-11-01T09:00:10Z');
    expect((await bridge.post(`${BRIDGE}/jobs/${first.id}/done`)).status).toBe(204);
    expect(
      (await bridge.post(`${BRIDGE}/jobs/${second.id}/failed`, { error: 'Printer unreachable' }))
        .status,
    ).toBe(204);

    const cashier = await asCashier();
    expect(printJobSchema.parse((await cashier.get(`${JOBS}/${first.id}`)).body)).toMatchObject({
      status: 'done',
      finishedAt: '2026-11-01T09:00:10.000Z',
      error: null,
    });
    expect(printJobSchema.parse((await cashier.get(`${JOBS}/${second.id}`)).body)).toMatchObject({
      status: 'failed',
      error: 'Printer unreachable',
    });
    // A finished job is not reported again.
    expect((await bridge.post(`${BRIDGE}/jobs/${first.id}/done`)).status).toBe(404);
  });

  it('offers a job again when the bridge that took it stopped, and gives up after three times', async () => {
    const job = await leaveJob();
    const bridge = asBridge(await bridgeKey());

    expect((await bridge.post(`${BRIDGE}/jobs/claim`)).status).toBe(200);
    // Not stale yet.
    clock = new Date('2026-11-01T09:00:30Z');
    expect((await bridge.post(`${BRIDGE}/jobs/claim`)).status).toBe(204);

    clock = new Date('2026-11-01T09:01:31Z');
    const again = await bridge.post(`${BRIDGE}/jobs/claim`);
    expect(again.status).toBe(200);
    expect(bridgePrintJobSchema.parse(again.body)).toMatchObject({ id: job.id, attempts: 2 });

    clock = new Date('2026-11-01T09:03:00Z');
    expect(
      bridgePrintJobSchema.parse((await bridge.post(`${BRIDGE}/jobs/claim`)).body).attempts,
    ).toBe(3);

    clock = new Date('2026-11-01T09:05:00Z');
    expect((await bridge.post(`${BRIDGE}/jobs/claim`)).status).toBe(204);
    const cashier = await asCashier();
    expect(printJobSchema.parse((await cashier.get(`${JOBS}/${job.id}`)).body)).toMatchObject({
      status: 'failed',
      attempts: 3,
      error: 'The print bridge stopped while printing',
    });
  });

  it('gives up a job whose printer was removed, and reaches only its own branch', async () => {
    const job = await leaveJob();
    await prisma.branch.update({
      where: { id: world.mall.id },
      data: { config: { printers: [kitchenPrinter] } },
    });
    const bridge = asBridge(await bridgeKey());

    expect((await bridge.post(`${BRIDGE}/jobs/claim`)).status).toBe(204);
    const cashier = await asCashier();
    expect(printJobSchema.parse((await cashier.get(`${JOBS}/${job.id}`)).body)).toMatchObject({
      status: 'failed',
      error: 'The printer was removed from the branch',
    });

    // The bridge of another branch sees nothing of the Mall.
    const other = await leaveJob('kitchen', kitchenPrinter.id);
    const downtown = asBridge(await bridgeKey(world.downtown.id));
    expect((await downtown.post(`${BRIDGE}/jobs/claim`)).status).toBe(204);
    expect((await downtown.post(`${BRIDGE}/jobs/${other.id}/done`)).status).toBe(404);
  });

  it('throws finished jobs away after a week', async () => {
    const job = await leaveJob();
    const bridge = asBridge(await bridgeKey());
    expect((await bridge.post(`${BRIDGE}/jobs/claim`)).status).toBe(200);
    expect((await bridge.post(`${BRIDGE}/jobs/${job.id}/done`)).status).toBe(204);

    clock = new Date('2026-11-09T09:00:00Z');
    expect((await bridge.post(`${BRIDGE}/jobs/claim`)).status).toBe(204);

    expect(await prisma.printJob.count()).toBe(0);
  });
});
