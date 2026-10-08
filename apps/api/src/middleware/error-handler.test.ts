import { apiErrorSchema } from '@pos/shared';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { errorHandler } from './error-handler';

describe('error handling', () => {
  it('answers unknown routes with the standard error body', async () => {
    const res = await request(createApp()).get('/api/v1/nope');

    expect(res.status).toBe(404);
    expect(apiErrorSchema.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('hides the details of an unexpected error behind a 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = express();
    app.get('/boom', () => {
      throw new Error('internal detail that must not leak');
    });
    app.use(errorHandler);

    const res = await request(app).get('/boom');

    expect(res.status).toBe(500);
    expect(apiErrorSchema.parse(res.body).error.code).toBe('INTERNAL_ERROR');
    expect(res.text).not.toContain('internal detail');
  });
});
