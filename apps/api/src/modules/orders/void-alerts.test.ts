import { randomUUID } from 'node:crypto';
import { defaultBrandSettings, type Order, orderSchema } from '@pos/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { openShift } from '../../../test/factories';
import { createTestPrisma, resetDatabase, testConfig } from '../../../test/helpers';
import { createMenuWorld, type MenuWorld } from '../../../test/menu-world';
import { as, signIn } from '../../../test/users-world';
import { createMemoryMailer } from '../../lib/mailer';
import { createPasswordHasher, hashProfiles } from '../../lib/password';
import { syncSystemRoles } from '../../lib/roles';

const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const mailer = createMemoryMailer();
const app = createApp({ prisma, config: testConfig({ AUTH_RATE_LIMIT_MAX: '1000' }), mailer });

let world: MenuWorld;
beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  mailer.sent.length = 0;
  world = await createMenuWorld(prisma, hasher);
  await openShift(prisma, world.users.cashier, world.mall);
});

const ORDERS = '/api/v1/orders';

async function colaOrder() {
  const api = as(app, await signIn(app, 'mall-manager@x.io'));
  const opened = orderSchema.parse(
    (await api.post(ORDERS, { branchId: world.mall.id, type: 'takeaway' })).body,
  );
  const order: Order = orderSchema.parse(
    (
      await api.post(`${ORDERS}/${opened.id}/lines`, {
        id: randomUUID(),
        kind: 'item',
        itemId: world.items.cola.id,
        quantity: 2,
      })
    ).body,
  );
  return { api, order };
}

describe('void alerts', () => {
  it('mail the brand addresses about a voided dish and a voided order', async () => {
    await prisma.brand.update({
      where: { id: world.pizza.id },
      data: {
        settings: {
          ...defaultBrandSettings,
          alerts: { voidEmails: ['owner@x.io', 'dev@x.io'] },
        },
      },
    });
    const { api, order } = await colaOrder();
    const line = order.lines[0];
    await api.post(`${ORDERS}/${order.id}/send`);
    const voided = await api.post(`${ORDERS}/${order.id}/lines/${line?.id}/void`, {
      reason: 'Order is wrong',
    });
    expect(voided.status).toBe(200);

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toEqual(['owner@x.io', 'dev@x.io']);
    expect(mailer.sent[0]?.subject).toBe(`Void at Pizza Mall: order ${order.number}, 10.000 KWD`);
    expect(mailer.sent[0]?.text).toContain('Voided: 2 × Cola');
    expect(mailer.sent[0]?.text).toContain('Reason: Order is wrong');
    expect(mailer.sent[0]?.text).toContain('By: ');
    expect(mailer.sent[0]?.text).toContain('Approved by: no approval needed');

    const { order: second } = await colaOrder();
    await api.post(`${ORDERS}/${second.id}/void`, { reason: 'Late order' });
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[1]?.text).toContain('Voided: the whole order');
    expect(mailer.sent[1]?.text).toContain(`Order: ${second.number}`);
  });

  it('send nothing while the brand has no addresses, and never stop the void', async () => {
    const { api, order } = await colaOrder();
    const voided = await api.post(`${ORDERS}/${order.id}/void`, { reason: 'Late order' });
    expect(voided.status).toBe(200);
    expect(mailer.sent).toHaveLength(0);
  });
});
