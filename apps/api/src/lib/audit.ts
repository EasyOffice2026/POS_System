import type { Prisma } from '../generated/prisma/client';
import type { PrismaClient } from './prisma';

export interface AuditEvent {
  action: string;
  userId?: string | null;
  brandId?: string | null;
  branchId?: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonObject;
  ip?: string | null;
  userAgent?: string | null;
}

// Appends a row to the audit log. Rows are never updated or deleted.
export function writeAudit(prisma: PrismaClient, event: AuditEvent) {
  return prisma.auditLog.create({
    data: {
      action: event.action,
      userId: event.userId ?? null,
      brandId: event.brandId ?? null,
      branchId: event.branchId ?? null,
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
      metadata: event.metadata ?? {},
      ip: event.ip ?? null,
      userAgent: event.userAgent ?? null,
    },
  });
}
