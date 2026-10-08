// Tests run in their own Postgres schema, so they never touch the data of a developer's
// main schema. The database server itself is the one in DATABASE_URL.
export const TEST_SCHEMA = 'pos_test';

const DEFAULT_DATABASE_URL = 'postgresql://pos:pos@localhost:5432/pos';

export function baseDatabaseUrl(): URL {
  const url = new URL(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
  url.searchParams.delete('schema');
  return url;
}

export function testDatabaseUrl(): string {
  const url = baseDatabaseUrl();
  url.searchParams.set('schema', TEST_SCHEMA);
  return url.toString();
}
