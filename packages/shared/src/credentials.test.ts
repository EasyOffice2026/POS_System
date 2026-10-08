import { describe, expect, it } from 'vitest';
import {
  passwordProblem,
  passwordSchema,
  pinProblem,
  pinSchema,
  setCredentialsRequestSchema,
} from './credentials';

describe('pinProblem', () => {
  it.each(['4829', '1357', '2468', '908172', '19283', '1212', '1020'])(
    'accepts the PIN %s',
    (pin) => {
      expect(pinProblem(pin)).toBeNull();
    },
  );

  it.each(['1111', '0000', '999999', '55555'])('refuses the repeated digits %s', (pin) => {
    expect(pinProblem(pin)).toBe('PIN_REPEATED');
  });

  it.each(['1234', '4321', '0123', '9876', '123456', '654321', '3456'])(
    'refuses the straight run %s',
    (pin) => {
      expect(pinProblem(pin)).toBe('PIN_SEQUENCE');
    },
  );

  it.each(['', '123', '1234567', '12a4', '12 34', '١٢٣٤'])(
    'refuses the wrong shape "%s"',
    (pin) => {
      expect(pinProblem(pin)).toBe('PIN_FORMAT');
    },
  );

  it('accepts a run that turns around, or has a gap', () => {
    expect(pinProblem('1243')).toBeNull();
    expect(pinProblem('1357')).toBeNull();
  });
});

describe('passwordProblem', () => {
  it('needs at least 10 characters', () => {
    expect(passwordProblem('a'.repeat(9))).toBe('PASSWORD_TOO_SHORT');
    expect(passwordProblem('a'.repeat(10))).toBeNull();
  });

  it('allows at most 128 characters', () => {
    expect(passwordProblem('a'.repeat(128))).toBeNull();
    expect(passwordProblem('a'.repeat(129))).toBe('PASSWORD_TOO_LONG');
  });

  it('counts characters, so Arabic is treated like English', () => {
    expect(passwordProblem('كلمةالمرور')).toBeNull();
    expect(passwordProblem('كلمةالسر')).toBe('PASSWORD_TOO_SHORT');
  });

  it('counts an emoji as one character', () => {
    expect(passwordProblem('😀'.repeat(10))).toBeNull();
  });
});

describe('pinSchema and passwordSchema', () => {
  it('report the problem as the message, for the web app to translate', () => {
    expect(pinSchema.safeParse('1111').error?.issues[0]?.message).toBe('PIN_REPEATED');
    expect(passwordSchema.safeParse('short').error?.issues[0]?.message).toBe('PASSWORD_TOO_SHORT');
  });
});

describe('setCredentialsRequestSchema', () => {
  it('accepts a type without a value, so the server makes one', () => {
    expect(setCredentialsRequestSchema.safeParse({ type: 'pin' }).success).toBe(true);
    expect(setCredentialsRequestSchema.safeParse({ type: 'password' }).success).toBe(true);
  });

  it('checks a given value against the rule for its type', () => {
    expect(setCredentialsRequestSchema.safeParse({ type: 'pin', value: '4829' }).success).toBe(
      true,
    );
    expect(setCredentialsRequestSchema.safeParse({ type: 'pin', value: '1234' }).success).toBe(
      false,
    );
    expect(setCredentialsRequestSchema.safeParse({ type: 'password', value: '4829' }).success).toBe(
      false,
    );
  });

  it('puts the problem on the value field', () => {
    const result = setCredentialsRequestSchema.safeParse({ type: 'pin', value: '1111' });

    expect(result.error?.issues[0]).toMatchObject({ path: ['value'], message: 'PIN_REPEATED' });
  });

  it('refuses unknown fields and unknown types', () => {
    expect(setCredentialsRequestSchema.safeParse({ type: 'pin', extra: 1 }).success).toBe(false);
    expect(setCredentialsRequestSchema.safeParse({ type: 'token' }).success).toBe(false);
  });
});
