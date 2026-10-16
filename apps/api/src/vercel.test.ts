import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createTestPrisma, testConfig } from '../test/helpers';
import * as roles from './lib/roles';
import { createVercelHandler } from './vercel';

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());

describe('the API as a Vercel function', () => {
  it('answers like the server, writes the roles once, and accepts a path without /api', async () => {
    const sync = vi.spyOn(roles, 'syncSystemRoles');
    const handler = createVercelHandler({ prisma, config: testConfig() });

    const health = await request(handler).get('/api/v1/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok', service: 'api' });
    expect(health.headers['x-content-type-options']).toBe('nosniff');

    const stripped = await request(handler).get('/v1/health/ready');
    expect(stripped.status).toBe(200);
    expect((await request(handler).get('/api/v1/brands')).status).toBe(401);
    expect(sync).toHaveBeenCalledTimes(1);
    await expect(prisma.role.count()).resolves.toBeGreaterThan(0);
    sync.mockRestore();
  });
});
