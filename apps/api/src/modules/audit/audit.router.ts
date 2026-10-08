import { type AuditLog, auditLogQuerySchema } from '@pos/shared';
import { Router } from 'express';
import type { Prisma } from '../../generated/prisma/client';
import { cursorPageArgs, splitPage } from '../../lib/pagination';
import { parseWith } from '../../lib/validate';
import { requestContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// The audit log, newest first. It is read through the scoped client, so a brand manager only
// sees events of their own brand, and events that belong to no brand (a failed sign-in with an
// unknown email) only reach a group admin.
export function createAuditRouter(): Router {
  const router = Router();

  router.get('/', requirePermission('audit:read'), async (req, res) => {
    const { db } = requestContext(req);
    const query = parseWith(auditLogQuerySchema, req.query);

    const filters: Prisma.AuditLogWhereInput[] = [];
    if (query.userId) filters.push({ userId: query.userId });
    if (query.branchId) filters.push({ branchId: query.branchId });
    if (query.action) filters.push({ action: query.action });
    if (query.from) filters.push({ createdAt: { gte: new Date(query.from) } });
    if (query.to) filters.push({ createdAt: { lte: new Date(query.to) } });

    const rows = await db.auditLog.findMany({
      ...(filters.length > 0 ? { where: { AND: filters } } : {}),
      ...cursorPageArgs(query.limit, query.cursor),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const page = splitPage(rows, query.limit);

    // Names of the people who acted, as far as the viewer may see them.
    const userIds = [...new Set(page.rows.flatMap((row) => (row.userId ? [row.userId] : [])))];
    const users =
      userIds.length > 0
        ? await db.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true },
          })
        : [];
    const nameById = new Map(users.map((user) => [user.id, user.name]));

    const data: AuditLog[] = page.rows.map((row) => ({
      id: row.id,
      action: row.action,
      userId: row.userId,
      userName: row.userId ? (nameById.get(row.userId) ?? null) : null,
      brandId: row.brandId,
      branchId: row.branchId,
      entityType: row.entityType,
      entityId: row.entityId,
      metadata: asRecord(row.metadata),
      ip: row.ip,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
    }));

    res.json({ data, nextCursor: page.nextCursor });
  });

  return router;
}
