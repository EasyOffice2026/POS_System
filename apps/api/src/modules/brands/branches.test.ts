import {
  branchDetailSchema,
  branchSchema,
  closedWeek,
  type OpeningHours,
  pageSchema,
} from '@pos/shared';
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

const BRANCHES = '/api/v1/branches';
const branchesOf = (brandId: string) => `/api/v1/brands/${brandId}/branches`;
const asAdmin = async () => as(app, await signIn(app, 'admin@x.io'));
const asPizzaManager = async () => as(app, await signIn(app, 'pizza@x.io'));
const auditRows = (action: string) => prisma.auditLog.findMany({ where: { action } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const name = { en: 'Pizza Corniche', ar: 'بيتزا الكورنيش' };

function week(days: Partial<OpeningHours>): OpeningHours {
  return { ...closedWeek(), ...days };
}

const ranges = (...pairs: [string, string][]) => ({
  kind: 'ranges' as const,
  ranges: pairs.map(([open, close]) => ({ open, close })),
});

const receipt = { name: 'Cash desk', kind: 'receipt', host: '192.168.1.50' };
const kitchen = { name: 'Pizza oven', kind: 'kitchen', host: 'oven.local', port: 9101 };

// The printers as sent, to compare without the ids the server made.
function withoutIds(printers: { id: string }[]) {
  return printers.map(({ id: _id, ...rest }) => rest);
}

function messagesOf(res: request.Response): string[] {
  return (errorOf(res).details ?? []).map((detail) => `${detail.path}:${detail.message}`);
}

describe('POST /brands/:id/branches', () => {
  it('lets a brand manager create a branch with only its names', async () => {
    const api = await asPizzaManager();

    const res = await api.post(branchesOf(world.pizza.id), { name });

    expect(res.status).toBe(201);
    const branch = branchDetailSchema.parse(res.body);
    expect(branch).toMatchObject({
      brandId: world.pizza.id,
      name,
      address: null,
      timezone: 'Asia/Kuwait',
      isActive: true,
      config: { openingHours: closedWeek(), printers: [], dayEndsAt: '00:00' },
    });

    const list = pageSchema(branchSchema).parse((await api.get(branchesOf(world.pizza.id))).body);
    expect(list.data.map((b) => b.id)).toContain(branch.id);
  });

  it('writes the creation to the audit log, with the brand and the branch', async () => {
    const api = await asPizzaManager();

    const res = await api.post(branchesOf(world.pizza.id), { name });

    const id = branchDetailSchema.parse(res.body).id;
    const [row] = await auditRows('branch.created');
    expect(row).toMatchObject({
      userId: world.users.pizzaManager.id,
      brandId: world.pizza.id,
      branchId: id,
      entityType: 'branch',
      entityId: id,
    });
    expect(row?.metadata).toEqual({ name, isActive: true });
  });

  it('takes the details, the opening hours and the printers in one request', async () => {
    const api = await asPizzaManager();

    const res = await api.post(branchesOf(world.pizza.id), {
      name,
      address: '  Corniche Road, Jeddah ',
      timezone: 'Asia/Dubai',
      config: {
        openingHours: week({
          friday: ranges(['14:00', '23:00']),
          saturday: { kind: 'all_day' },
        }),
        printers: [receipt, kitchen],
      },
    });

    expect(res.status).toBe(201);
    const branch = branchDetailSchema.parse(res.body);
    expect(branch).toMatchObject({ address: 'Corniche Road, Jeddah', timezone: 'Asia/Dubai' });
    expect(branch.config.openingHours.friday).toEqual(ranges(['14:00', '23:00']));
    expect(branch.config.openingHours.saturday).toEqual({ kind: 'all_day' });
    expect(withoutIds(branch.config.printers)).toEqual([{ ...receipt, port: 9100 }, kitchen]);
    expect(branch.config.printers.every((printer) => uuid.test(printer.id))).toBe(true);
  });

  it('lets a group admin create a branch for any brand', async () => {
    const api = await asAdmin();

    const res = await api.post(branchesOf(world.burger.id), { name });

    expect(res.status).toBe(201);
    expect(branchDetailSchema.parse(res.body).brandId).toBe(world.burger.id);
  });

  it('can start a branch as inactive, to be set up before it opens', async () => {
    const api = await asPizzaManager();

    const res = await api.post(branchesOf(world.pizza.id), { name, isActive: false });

    expect(branchDetailSchema.parse(res.body).isActive).toBe(false);
  });

  it('answers that a brand was not found when a brand manager creates a branch for another brand', async () => {
    const api = await asPizzaManager();
    const before = await prisma.branch.count();

    const res = await api.post(branchesOf(world.burger.id), { name });

    expect(res.status).toBe(404);
    expect(errorOf(res).code).toBe('NOT_FOUND');
    expect(await prisma.branch.count()).toBe(before);
    expect(await auditRows('branch.created')).toHaveLength(0);
  });

  it('answers the same for a brand that does not exist', async () => {
    const api = await asPizzaManager();

    const other = await api.post(branchesOf(world.burger.id), { name });
    const missing = await api.post(branchesOf('0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'), { name });

    expect(other.status).toBe(missing.status);
    expect(other.body).toEqual(missing.body);
  });

  it('is not allowed for a branch manager or a cashier', async () => {
    for (const email of ['mall-manager@x.io', 'cashier@x.io']) {
      const api = as(app, await signIn(app, email));

      const res = await api.post(branchesOf(world.pizza.id), { name });

      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe('FORBIDDEN');
    }
  });

  it('refuses a name with only an English value', async () => {
    const api = await asPizzaManager();

    const res = await api.post(branchesOf(world.pizza.id), { name: { en: 'Pizza Corniche' } });

    expect(res.status).toBe(400);
    expect(messagesOf(res)).toEqual(['name.ar:NAME_REQUIRED']);
  });

  it.each(['Riyadh', '+03:00', 'Mars/Base', 'asia/riyadh'])(
    'refuses the time zone %s',
    async (timezone) => {
      const api = await asPizzaManager();

      const res = await api.post(branchesOf(world.pizza.id), { name, timezone });

      expect(messagesOf(res)).toEqual(['timezone:TIMEZONE_INVALID']);
    },
  );

  it('refuses opening hours that overlap, names the day and creates nothing', async () => {
    const api = await asPizzaManager();
    const before = await prisma.branch.count();

    const res = await api.post(branchesOf(world.pizza.id), {
      name,
      config: { openingHours: week({ monday: ranges(['09:00', '14:00'], ['13:00', '18:00']) }) },
    });

    expect(res.status).toBe(400);
    expect(errorOf(res).code).toBe('VALIDATION_ERROR');
    expect(messagesOf(res)).toEqual(['config.openingHours.monday:HOURS_OVERLAP']);
    expect(await prisma.branch.count()).toBe(before);
  });

  it('refuses printers with a bad address, a taken name or a bad port', async () => {
    const api = await asPizzaManager();

    const res = await api.post(branchesOf(world.pizza.id), {
      name,
      config: {
        printers: [
          { ...receipt, host: 'http://192.168.1.50' },
          { ...receipt, name: 'cash desk', host: '192.168.1.51' },
          { ...kitchen, port: 70000 },
        ],
      },
    });

    expect(messagesOf(res)).toEqual([
      'config.printers.0.host:PRINTER_HOST_INVALID',
      'config.printers.2.port:PRINTER_PORT_INVALID',
      'config.printers.1.name:PRINTER_NAME_TAKEN',
    ]);
  });

  it('refuses a brand id in the body, because the brand comes from the address', async () => {
    const api = await asPizzaManager();

    const res = await api.post(branchesOf(world.pizza.id), { name, brandId: world.burger.id });

    expect(res.status).toBe(400);
  });

  it('needs a signed-in person', async () => {
    const res = await request(app).post(branchesOf(world.pizza.id)).send({ name });

    expect(res.status).toBe(401);
  });
});

describe('GET /branches/:id', () => {
  it('shows a branch that was never set up with closed days and no printers', async () => {
    const api = await asPizzaManager();

    const res = await api.get(`${BRANCHES}/${world.mall.id}`);

    expect(res.status).toBe(200);
    expect(branchDetailSchema.parse(res.body).config).toEqual({
      openingHours: closedWeek(),
      printers: [],
      dayEndsAt: '00:00',
    });
  });

  it('shows a group admin any branch and a brand manager the branches of their brand', async () => {
    const admin = await asAdmin();
    const manager = await asPizzaManager();

    expect((await admin.get(`${BRANCHES}/${world.airport.id}`)).status).toBe(200);
    expect((await manager.get(`${BRANCHES}/${world.downtown.id}`)).status).toBe(200);
  });

  it('shows a branch manager their own branch and not another one', async () => {
    const api = as(app, await signIn(app, 'mall-manager@x.io'));

    const own = await api.get(`${BRANCHES}/${world.mall.id}`);
    const other = await api.get(`${BRANCHES}/${world.downtown.id}`);

    expect(own.status).toBe(200);
    expect(other.status).toBe(404);
  });

  it('answers the same for a branch of another brand as for one that does not exist', async () => {
    const api = await asPizzaManager();

    const other = await api.get(`${BRANCHES}/${world.airport.id}`);
    const missing = await api.get(`${BRANCHES}/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b`);

    expect(other.status).toBe(404);
    expect(other.body).toEqual(missing.body);
  });

  it('is not allowed for a cashier', async () => {
    const api = as(app, await signIn(app, 'cashier@x.io'));

    expect((await api.get(`${BRANCHES}/${world.mall.id}`)).status).toBe(403);
  });

  it('refuses an id that is not a UUID', async () => {
    const api = await asAdmin();

    expect((await api.get(`${BRANCHES}/nope`)).status).toBe(400);
  });
});

describe('PATCH /branches/:id', () => {
  it('changes the name, address and time zone, and lists what changed in the audit log', async () => {
    const api = await asPizzaManager();

    const res = await api.patch(`${BRANCHES}/${world.mall.id}`, {
      name,
      address: 'Mall of the Emirates',
      timezone: 'Asia/Dubai',
    });

    expect(res.status).toBe(200);
    expect(branchDetailSchema.parse(res.body)).toMatchObject({
      name,
      address: 'Mall of the Emirates',
      timezone: 'Asia/Dubai',
    });

    const [row] = await auditRows('branch.updated');
    expect(row).toMatchObject({
      userId: world.users.pizzaManager.id,
      brandId: world.pizza.id,
      branchId: world.mall.id,
      entityType: 'branch',
      entityId: world.mall.id,
    });
    expect(row?.metadata).toEqual({ changed: ['name', 'address', 'timezone'] });
  });

  it('clears the address with null or an empty text', async () => {
    const api = await asPizzaManager();
    await api.patch(`${BRANCHES}/${world.mall.id}`, { address: 'Somewhere' });

    const cleared = await api.patch(`${BRANCHES}/${world.mall.id}`, { address: '  ' });

    expect(branchDetailSchema.parse(cleared.body).address).toBeNull();
  });

  it('sets the opening hours, with the ranges of a day in the order of the clock', async () => {
    const api = await asPizzaManager();

    const res = await api.patch(`${BRANCHES}/${world.mall.id}`, {
      config: {
        openingHours: week({
          sunday: ranges(['17:00', '23:00'], ['09:00', '14:00']),
          wednesday: ranges(['18:00', '02:00']),
          friday: { kind: 'all_day' },
        }),
      },
    });

    expect(res.status).toBe(200);
    const hours = branchDetailSchema.parse(res.body).config.openingHours;
    expect(hours.sunday).toEqual(ranges(['09:00', '14:00'], ['17:00', '23:00']));
    expect(hours.wednesday).toEqual(ranges(['18:00', '02:00']));
    expect(hours.friday).toEqual({ kind: 'all_day' });
    expect(hours.monday).toEqual({ kind: 'closed' });

    const [row] = await auditRows('branch.updated');
    expect(row?.metadata).toEqual({ changed: ['openingHours'] });
  });

  it('refuses opening hours that overlap, and names the day', async () => {
    const api = await asPizzaManager();

    const res = await api.patch(`${BRANCHES}/${world.mall.id}`, {
      config: { openingHours: week({ tuesday: ranges(['09:00', '14:00'], ['13:00', '18:00']) }) },
    });

    expect(res.status).toBe(400);
    expect(errorOf(res).code).toBe('VALIDATION_ERROR');
    expect(messagesOf(res)).toEqual(['config.openingHours.tuesday:HOURS_OVERLAP']);
    expect(await auditRows('branch.updated')).toHaveLength(0);
  });

  it('refuses Saturday night running into Sunday morning', async () => {
    const api = await asPizzaManager();

    const res = await api.patch(`${BRANCHES}/${world.mall.id}`, {
      config: {
        openingHours: week({
          saturday: ranges(['22:00', '03:00']),
          sunday: ranges(['02:00', '09:00']),
        }),
      },
    });

    expect(messagesOf(res)).toEqual(['config.openingHours.sunday:HOURS_OVERLAP']);
  });

  it('refuses a range that opens and closes at the same time, and a time that is not a time', async () => {
    const api = await asPizzaManager();

    const res = await api.patch(`${BRANCHES}/${world.mall.id}`, {
      config: {
        openingHours: week({
          monday: ranges(['09:00', '09:00']),
          tuesday: ranges(['9:00', '17:00']),
        }),
      },
    });

    expect(messagesOf(res)).toEqual([
      'config.openingHours.monday.ranges.0.close:HOURS_RANGE_EMPTY',
      'config.openingHours.tuesday.ranges.0.open:HOURS_TIME_FORMAT',
    ]);
  });

  it('sets the printers, giving each new one an id and the usual port', async () => {
    const api = await asPizzaManager();

    const res = await api.patch(`${BRANCHES}/${world.mall.id}`, {
      config: { printers: [receipt, kitchen] },
    });

    expect(res.status).toBe(200);
    const printers = branchDetailSchema.parse(res.body).config.printers;
    expect(withoutIds(printers)).toEqual([{ ...receipt, port: 9100 }, kitchen]);
    expect(printers.every((printer) => uuid.test(printer.id))).toBe(true);

    const [row] = await auditRows('branch.updated');
    expect(row?.metadata).toEqual({ changed: ['printers'] });
  });

  it('keeps the id of a printer that is sent back, drops one that is left out, and allows two receipt printers', async () => {
    const api = await asPizzaManager();
    const first = branchDetailSchema.parse(
      (
        await api.patch(`${BRANCHES}/${world.mall.id}`, {
          config: { printers: [receipt, kitchen] },
        })
      ).body,
    ).config.printers;
    const [desk, oven] = first;

    const res = await api.patch(`${BRANCHES}/${world.mall.id}`, {
      config: {
        printers: [
          { ...desk, name: 'Front desk' },
          { name: 'Second desk', kind: 'receipt', host: '192.168.1.52' },
        ],
      },
    });

    const printers = branchDetailSchema.parse(res.body).config.printers;
    expect(printers).toHaveLength(2);
    expect(printers[0]).toMatchObject({ id: desk?.id, name: 'Front desk', host: desk?.host });
    expect(printers.map((p) => p.id)).not.toContain(oven?.id);
    expect(printers.filter((p) => p.kind === 'receipt')).toHaveLength(2);
  });

  it('changes the hours without touching the printers, and the printers without touching the hours', async () => {
    const api = await asPizzaManager();
    await api.patch(`${BRANCHES}/${world.mall.id}`, { config: { printers: [receipt] } });

    const hours = week({ monday: ranges(['09:00', '22:00']) });
    const afterHours = await api.patch(`${BRANCHES}/${world.mall.id}`, {
      config: { openingHours: hours },
    });
    const afterPrinters = await api.patch(`${BRANCHES}/${world.mall.id}`, {
      config: { printers: [] },
    });

    expect(branchDetailSchema.parse(afterHours.body).config.printers).toHaveLength(1);
    expect(branchDetailSchema.parse(afterPrinters.body).config.openingHours).toEqual(hours);
  });

  it('keeps parts of the configuration that this module does not know about', async () => {
    const api = await asPizzaManager();
    await prisma.branch.update({
      where: { id: world.mall.id },
      data: { config: { receiptFooter: 'Thank you' } },
    });

    await api.patch(`${BRANCHES}/${world.mall.id}`, {
      config: { openingHours: week({ monday: { kind: 'all_day' } }) },
    });

    const stored = await prisma.branch.findUniqueOrThrow({ where: { id: world.mall.id } });
    expect(stored.config).toMatchObject({
      receiptFooter: 'Thank you',
      openingHours: { monday: { kind: 'all_day' } },
      printers: [],
    });
  });

  it('deactivates a branch and keeps its people and its history', async () => {
    const api = await asPizzaManager();
    const assigned = await prisma.userBranch.count({ where: { branchId: world.mall.id } });

    const res = await api.patch(`${BRANCHES}/${world.mall.id}`, { isActive: false });

    expect(res.status).toBe(200);
    expect(branchDetailSchema.parse(res.body).isActive).toBe(false);
    expect(await prisma.userBranch.count({ where: { branchId: world.mall.id } })).toBe(assigned);
    expect(await prisma.branch.findUnique({ where: { id: world.mall.id } })).not.toBeNull();

    const [row] = await auditRows('branch.updated');
    expect(row?.metadata).toEqual({ changed: ['isActive'], isActive: false });
  });

  it('refuses PIN sign-in at the branch once a manager has deactivated it, until it is activated again', async () => {
    const api = await asPizzaManager();
    const pinAtMall = () =>
      request(app)
        .post('/api/v1/auth/login')
        .send({ type: 'pin', branchId: world.mall.id, staffCode: '1001', pin: '4829' });
    expect((await pinAtMall()).status).toBe(200);

    await api.patch(`${BRANCHES}/${world.mall.id}`, { isActive: false });

    const refused = await pinAtMall();
    expect(refused.status).toBe(403);
    expect(errorOf(refused).code).toBe('BRANCH_INACTIVE');

    await api.patch(`${BRANCHES}/${world.mall.id}`, { isActive: true });
    expect((await pinAtMall()).status).toBe(200);
  });

  it('lists a deactivated branch, so a manager can activate it again', async () => {
    const api = await asPizzaManager();
    await api.patch(`${BRANCHES}/${world.mall.id}`, { isActive: false });

    const list = pageSchema(branchSchema).parse((await api.get(branchesOf(world.pizza.id))).body);
    expect(list.data.find((b) => b.id === world.mall.id)?.isActive).toBe(false);

    const res = await api.patch(`${BRANCHES}/${world.mall.id}`, { isActive: true });
    expect(branchDetailSchema.parse(res.body).isActive).toBe(true);
  });

  it('says nothing and writes nothing when nothing changes', async () => {
    const api = await asPizzaManager();
    const current = branchDetailSchema.parse((await api.get(`${BRANCHES}/${world.mall.id}`)).body);

    const res = await api.patch(`${BRANCHES}/${world.mall.id}`, {
      name: current.name,
      timezone: current.timezone,
      isActive: true,
      config: { openingHours: current.config.openingHours, printers: [] },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(current);
    expect(await auditRows('branch.updated')).toHaveLength(0);
  });

  it('refuses a request that changes nothing at all', async () => {
    const api = await asPizzaManager();

    const res = await api.patch(`${BRANCHES}/${world.mall.id}`, {});

    expect(messagesOf(res)).toEqual([':NOTHING_TO_UPDATE']);
  });

  it('refuses to move a branch to another brand', async () => {
    const api = await asAdmin();

    const res = await api.patch(`${BRANCHES}/${world.mall.id}`, { brandId: world.burger.id });

    expect(res.status).toBe(400);
    const stored = await prisma.branch.findUniqueOrThrow({ where: { id: world.mall.id } });
    expect(stored.brandId).toBe(world.pizza.id);
  });

  it('lets a group admin change a branch of any brand', async () => {
    const api = await asAdmin();

    const res = await api.patch(`${BRANCHES}/${world.airport.id}`, { name });

    expect(branchDetailSchema.parse(res.body).name).toEqual(name);
  });

  it('answers that a branch was not found when a brand manager changes one of another brand', async () => {
    const api = await asPizzaManager();

    const res = await api.patch(`${BRANCHES}/${world.airport.id}`, { name });

    expect(res.status).toBe(404);
    expect(errorOf(res).code).toBe('NOT_FOUND');
    const stored = await prisma.branch.findUniqueOrThrow({ where: { id: world.airport.id } });
    expect(stored.name).toEqual({ en: 'Burger Airport', ar: 'Burger Airport (ar)' });
  });

  it('is not allowed for a branch manager, even for their own branch', async () => {
    const api = as(app, await signIn(app, 'mall-manager@x.io'));

    const res = await api.patch(`${BRANCHES}/${world.mall.id}`, { name });

    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe('FORBIDDEN');
  });
});

describe('the audit log of branches', () => {
  it('shows a brand manager the changes of branches of their own brand and none of another', async () => {
    const admin = await asAdmin();
    await admin.patch(`${BRANCHES}/${world.mall.id}`, { name });
    await admin.patch(`${BRANCHES}/${world.airport.id}`, { name });

    const manager = await asPizzaManager();
    const res = await manager.get('/api/v1/audit-logs?action=branch.updated');

    const rows = (res.body as { data: { entityId: string }[] }).data;
    expect(rows.map((row) => row.entityId)).toEqual([world.mall.id]);
  });
});
