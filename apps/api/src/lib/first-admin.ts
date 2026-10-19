import { createUserRequestSchema } from '@pos/shared';
import { writeAudit } from './audit';
import { generatePassword } from './generate-credentials';
import type { PasswordHasher } from './password';
import type { PrismaClient } from './prisma';
import { syncSystemRoles } from './roles';

// A problem with what was typed, in a sentence for the person at the command line.
export class FirstAdminError extends Error {}

const problemTexts: Record<string, string> = {
  name: 'The name must have 1 to 100 characters.',
  email: 'The email is not a valid email address.',
};

export interface FirstAdmin {
  id: string;
  email: string;
  // Shown once. Only its hash is stored.
  password: string;
}

// Creates a group admin with a password that is made up on the spot. A database that holds real
// data cannot use the demo seed, which has accounts with a public password, so this is how the
// first person gets in. They can set their own password afterwards.
export async function createFirstAdmin(
  prisma: PrismaClient,
  hasher: PasswordHasher,
  input: { name: string; email: string },
): Promise<FirstAdmin> {
  const parsed = createUserRequestSchema.safeParse({
    name: input.name,
    email: input.email,
    roleKey: 'group_admin',
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    throw new FirstAdminError(problemTexts[String(field)] ?? 'The name or the email is not valid.');
  }
  const { name, email } = parsed.data;
  if (!email) throw new FirstAdminError(problemTexts.email);

  // The built-in roles are written when the API starts, so a new database may not have them yet.
  await syncSystemRoles(prisma);
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'group_admin' } });

  if (await prisma.user.findUnique({ where: { email } })) {
    throw new FirstAdminError(`The email ${email} is already used.`);
  }

  const password = generatePassword();
  const user = await prisma.user.create({
    data: {
      roleId: role.id,
      brandId: null,
      name,
      email,
      passwordHash: await hasher.hash(password),
    },
  });

  await writeAudit(prisma, {
    action: 'user.created',
    entityType: 'user',
    entityId: user.id,
    metadata: { role: 'group_admin', source: 'admin:create' },
  });

  return { id: user.id, email, password };
}

export interface ResetAdmin {
  id: string;
  email: string;
  // Shown once. Only its hash is stored.
  password: string;
}

// Gives a group admin a new password that is made up on the spot, for when the owner is locked out
// and nobody else can reset it from Users. Their sessions end and the lock-out is cleared.
export async function resetAdminPassword(
  prisma: PrismaClient,
  hasher: PasswordHasher,
  email: string,
): Promise<ResetAdmin> {
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  if (!user) throw new FirstAdminError(`There is no account with the email ${email}.`);
  if (user.role.key !== 'group_admin') {
    throw new FirstAdminError(
      `${email} is not a group admin. A group admin resets other passwords under Users.`,
    );
  }

  const password = generatePassword();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hasher.hash(password),
      failedLoginAttempts: 0,
      lockedUntil: null,
      isActive: true,
    },
  });
  await prisma.refreshToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await writeAudit(prisma, {
    action: 'user.credentials_reset',
    entityType: 'user',
    entityId: user.id,
    metadata: { type: 'password', generated: true, source: 'admin:reset' },
  });

  return { id: user.id, email, password };
}
