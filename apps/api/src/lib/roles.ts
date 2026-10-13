import { systemRoles } from '@pos/shared';
import type { PrismaClient } from './prisma';

// The built-in roles live in code. Writing them at startup keeps the database in step with a deploy.
export async function syncSystemRoles(prisma: PrismaClient): Promise<void> {
  for (const role of systemRoles) {
    const data = { name: role.name, scope: role.scope, permissions: [...role.permissions] };
    await prisma.role.upsert({
      where: { key: role.key },
      update: data,
      create: { key: role.key, ...data },
    });
  }
}
