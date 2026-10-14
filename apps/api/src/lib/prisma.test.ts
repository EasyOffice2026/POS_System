import { describe, expect, it } from 'vitest';
import { poolOptions } from './prisma';

describe('the settings of the database address', () => {
  it('takes out the schema and the connection limit, and keeps the rest', () => {
    expect(
      poolOptions(
        'postgresql://u:p@db.example.com:5432/postgres?schema=pos&sslmode=require&connection_limit=5',
      ),
    ).toEqual({
      connectionString: 'postgresql://u:p@db.example.com:5432/postgres?sslmode=require',
      schema: 'pos',
      max: 5,
    });
    expect(poolOptions('postgresql://u:p@localhost:5432/pos')).toEqual({
      connectionString: 'postgresql://u:p@localhost:5432/pos',
      schema: undefined,
      max: undefined,
    });
  });

  it('refuses a connection limit that is not a whole number of at least 1', () => {
    for (const limit of ['0', '-1', 'ten', '2.5']) {
      expect(() => poolOptions(`postgresql://localhost/pos?connection_limit=${limit}`)).toThrow(
        'connection_limit',
      );
    }
  });
});
