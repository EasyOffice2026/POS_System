import { describe, expect, it } from 'vitest';
import { loginRequestSchema } from './auth';

const branchId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

describe('loginRequestSchema', () => {
  it('trims and lowercases the email of a password login', () => {
    const parsed = loginRequestSchema.parse({
      type: 'password',
      email: '  Admin@POS.local ',
      password: 'secret',
    });

    expect(parsed).toEqual({ type: 'password', email: 'admin@pos.local', password: 'secret' });
  });

  it('accepts a PIN login with a branch and staff code', () => {
    const parsed = loginRequestSchema.parse({
      type: 'pin',
      branchId,
      staffCode: '1001',
      pin: '123456',
    });

    expect(parsed.type).toBe('pin');
  });

  it.each(['123', '1234567', '12a4', ''])('rejects the PIN "%s"', (pin) => {
    const result = loginRequestSchema.safeParse({ type: 'pin', branchId, staffCode: '1', pin });

    expect(result.success).toBe(false);
  });

  it('rejects a malformed email', () => {
    const result = loginRequestSchema.safeParse({
      type: 'password',
      email: 'not-an-email',
      password: 'x',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown login type', () => {
    expect(loginRequestSchema.safeParse({ type: 'token', value: 'x' }).success).toBe(false);
  });
});
