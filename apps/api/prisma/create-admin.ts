// Creates the first group admin of a database that is not for demos. The demo seed (seed.ts) has
// accounts with a public password and refuses to run against a database on another computer, so
// this is the way in for a real one, for example a hosted database.
//
//   npm run admin:create -- --email owner@example.com --name "Owner Name"
//
// The password is made up and shown once.
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config';
import { createFirstAdmin, FirstAdminError } from '../src/lib/first-admin';
import { createPasswordHasher, hashProfiles } from '../src/lib/password';
import { createPrismaClient } from '../src/lib/prisma';

const usage = 'Usage: npm run admin:create -- --email owner@example.com --name "Owner Name"';

let values: { email?: string; name?: string };
try {
  ({ values } = parseArgs({
    options: { email: { type: 'string' }, name: { type: 'string' } },
    strict: true,
  }));
} catch (error) {
  console.error(`${(error as Error).message}\n${usage}`);
  process.exit(1);
}
if (!values.email || !values.name) {
  console.error(usage);
  process.exit(1);
}

const config = loadConfig();
const prisma = createPrismaClient(config.databaseUrl);
const hasher = createPasswordHasher(hashProfiles[config.passwordHashProfile]);

try {
  const admin = await createFirstAdmin(prisma, hasher, { name: values.name, email: values.email });

  console.log(`Group admin created in the database at ${new URL(config.databaseUrl).host}.`);
  console.log(`  Email:    ${admin.email}`);
  console.log(`  Password: ${admin.password}`);
  console.log('\nThe password is shown only this once. Write it down, sign in, and then set a');
  console.log('password of your own under Users.');
} catch (error) {
  if (error instanceof FirstAdminError) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await prisma.$disconnect();
}
