import { apiErrorSchema, healthResponseSchema } from '@pos/shared';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBridgeServer } from './app';

describe('print bridge', () => {
  const server = createBridgeServer();
  let baseUrl = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('reports that the bridge is up', async () => {
    const res = await fetch(`${baseUrl}/health`);

    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(await res.json())).toEqual({
      status: 'ok',
      service: 'print-bridge',
    });
  });

  it('answers unknown routes with the standard error body', async () => {
    const res = await fetch(`${baseUrl}/nope`);

    expect(res.status).toBe(404);
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe('NOT_FOUND');
  });
});
