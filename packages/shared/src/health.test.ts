import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health';

describe('healthResponseSchema', () => {
  it('accepts an ok status', () => {
    expect(healthResponseSchema.parse({ status: 'ok', service: 'api' })).toEqual({
      status: 'ok',
      service: 'api',
    });
  });

  it('rejects any other status', () => {
    expect(healthResponseSchema.safeParse({ status: 'degraded', service: 'api' }).success).toBe(
      false,
    );
  });
});
