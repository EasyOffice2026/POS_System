// Gives a group admin a new password, for when the owner is locked out of a real database and
// nobody else can reset it from Users.
//
//   npm run admin:reset -- --email owner@example.com
//
// The password is made up and shown once.
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config';
import { FirstAdminError, resetAdminPassword } from '../src/lib/first-admin';
import { createPasswordHasher, hashProfiles } from '../src/lib/password';
import { createPrismaClient } from '../src/lib/prisma';

const usage = 'Usage: npm run admin:reset -- --email owner@example.com';

let values: { email?: string };
try {
  ({ values } = parseArgs({ options: { email: { type: 'string' } }, strict: true }));
} catch (error) {
  console.error(`${(error as Error).message}\n${usage}`);
  process.exit(1);
}
if (!values.email) {
  console.error(usage);
  process.exit(1);
}

const config = loadConfig();
const prisma = createPrismaClient(config.databaseUrl);
const hasher = createPasswordHasher(hashProfiles[config.passwordHashProfile]);

try {
  const admin = await resetAdminPassword(prisma, hasher, values.email);

  console.log(`Password reset in the database at ${new URL(config.databaseUrl).host}.`);
  console.log(`  Email:    ${admin.email}`);
  console.log(`  Password: ${admin.password}`);
  console.log('\nThe password is shown only this once. Sign in, then set a password of your own');
  console.log('with "Change password" in the header.');
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
