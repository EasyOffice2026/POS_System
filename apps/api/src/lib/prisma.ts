import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

export { PrismaClient };

// A "schema" parameter in the URL (…/pos?schema=pos_test) selects a non-default Postgres schema.
export function createPrismaClient(databaseUrl: string): PrismaClient {
  const url = new URL(databaseUrl);
  const schema = url.searchParams.get('schema') ?? undefined;
  url.searchParams.delete('schema');

  const adapter = new PrismaPg(
    { connectionString: url.toString(), connectionTimeoutMillis: 10_000 },
    schema ? { schema } : undefined,
  );
  return new PrismaClient({ adapter });
}
