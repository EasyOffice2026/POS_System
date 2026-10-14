import { healthResponseSchema } from '@pos/shared';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { LogLine } from '../../middleware/request-log';
import { createPrismaClient } from '../../lib/prisma';
import { createTestPrisma, testConfig } from '../../../test/helpers';

const prisma = createTestPrisma();
// Nothing listens on port 1, so this database can never be reached.
const unreachable = createPrismaClient('postgresql://pos:pos@127.0.0.1:1/pos');
afterAll(async () => {
  await prisma.$disconnect();
  await unreachable.$disconnect();
});

describe('GET /api/v1/health', () => {
  it('reports that the API is up', async () => {
    const res = await request(createApp({ prisma, config: testConfig() })).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(res.body)).toEqual({ status: 'ok', service: 'api' });
  });

  it('is ready when the database answers, and says so when it does not', async () => {
    const ready = await request(createApp({ prisma, config: testConfig() })).get(
      '/api/v1/health/ready',
    );
    expect(ready.status).toBe(200);

    const app = createApp({ prisma: unreachable, config: testConfig() });
    const down = await request(app).get('/api/v1/health/ready');
    expect(down.status).toBe(503);
    expect((down.body as { error: { code: string } }).error.code).toBe('DATABASE_UNAVAILABLE');
    // The process itself is still up.
    expect((await request(app).get('/api/v1/health')).status).toBe(200);
  });
});

describe('the log of requests', () => {
  it('writes one line per request, without the query, and answers with its id', async () => {
    const lines: LogLine[] = [];
    const app = createApp({ prisma, config: testConfig(), log: (line) => lines.push(line) });

    const res = await request(app).get('/api/v1/customers?phone=96599991234');
    await request(app).get('/api/v1/health');
    await request(app).post('/api/v1/auth/login').set('X-Request-Id', 'till-7.req-0001').send({});

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      lines.map(({ level, method, path, status }) => ({ level, method, path, status })),
    ).toEqual([
      { level: 'warn', method: 'GET', path: '/api/v1/customers', status: 401 },
      { level: 'warn', method: 'POST', path: '/api/v1/auth/login', status: 400 },
    ]);
    expect(lines[0]?.requestId).toBe(res.headers['x-request-id']);
    expect(lines[1]?.requestId).toBe('till-7.req-0001');
    expect(JSON.stringify(lines)).not.toContain('96599991234');
    expect(lines[0]?.ms).toBeGreaterThanOrEqual(0);
  });

  it('makes its own id when the one given looks wrong', async () => {
    const lines: LogLine[] = [];
    const app = createApp({ prisma, config: testConfig(), log: (line) => lines.push(line) });
    const res = await request(app)
      .get('/api/v1/brands')
      .set('X-Request-Id', 'bad id; with spaces!');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(lines[0]?.requestId).toBe(res.headers['x-request-id']);
  });
});
