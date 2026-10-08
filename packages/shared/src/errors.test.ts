import { describe, expect, it } from 'vitest';
import { apiError, apiErrorSchema } from './errors';

describe('apiError', () => {
  it('builds a body that matches the error schema', () => {
    const body = apiError('NOT_FOUND', 'Route not found');

    expect(apiErrorSchema.parse(body)).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });

  it('includes details only when given', () => {
    const body = apiError('VALIDATION_ERROR', 'Invalid input', [{ field: 'phone' }]);

    expect(body.error.details).toEqual([{ field: 'phone' }]);
    expect('details' in apiError('X', 'y')).toBe(false);
  });

  it('rejects a body without a code', () => {
    expect(apiErrorSchema.safeParse({ error: { message: 'oops' } }).success).toBe(false);
  });
});
