import { describe, expect, it } from 'vitest';
import { cursorQuerySchema, pageSchema } from './pagination';
import { z } from 'zod';

describe('cursorQuerySchema', () => {
  it('defaults the limit to 50', () => {
    expect(cursorQuerySchema.parse({})).toEqual({ limit: 50 });
  });

  it('reads the limit from a query string value', () => {
    expect(cursorQuerySchema.parse({ limit: '10' }).limit).toBe(10);
  });

  it.each(['0', '101', '-1', 'abc'])('rejects the limit "%s"', (limit) => {
    expect(cursorQuerySchema.safeParse({ limit }).success).toBe(false);
  });

  it('rejects a cursor that is not a UUID', () => {
    expect(cursorQuerySchema.safeParse({ cursor: 'abc' }).success).toBe(false);
  });
});

describe('pageSchema', () => {
  it('wraps an item schema with data and a cursor', () => {
    const schema = pageSchema(z.object({ id: z.string() }));

    expect(schema.parse({ data: [{ id: 'a' }], nextCursor: null })).toEqual({
      data: [{ id: 'a' }],
      nextCursor: null,
    });
  });
});
