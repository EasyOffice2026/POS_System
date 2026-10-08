import { healthResponseSchema } from '@pos/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app';

describe('GET /api/v1/health', () => {
  it('reports that the API is up', async () => {
    const res = await request(createApp()).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(res.body)).toEqual({ status: 'ok', service: 'api' });
  });
});
