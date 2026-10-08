import { describe, expect, it } from 'vitest';
import { auditActions, auditLogQuerySchema } from './audit';

describe('auditLogQuerySchema', () => {
  it('has the cursor defaults and no filters', () => {
    expect(auditLogQuerySchema.parse({})).toEqual({ limit: 50 });
  });

  it('accepts a date range, with or without an offset', () => {
    const query = auditLogQuerySchema.parse({
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-09T23:59:59+03:00',
      action: 'user.created',
    });

    expect(query.action).toBe('user.created');
  });

  it.each([{ from: 'yesterday' }, { to: '2026-10-09' }, { userId: 'x' }, { action: '' }])(
    'refuses %j',
    (query) => {
      expect(auditLogQuerySchema.safeParse(query).success).toBe(false);
    },
  );
});

describe('auditActions', () => {
  it('has no repeats and uses area.thing.result names', () => {
    expect(new Set(auditActions).size).toBe(auditActions.length);
    for (const action of auditActions) expect(action).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
  });
});
