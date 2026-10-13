import { z } from 'zod';
import { cursorQuerySchema } from './pagination';

// The actions the system writes to the audit log today. Later modules add their own.
export const auditActions = [
  'auth.login.success',
  'auth.login.failed',
  'auth.login.locked',
  'auth.login.blocked',
  'auth.logout',
  'auth.refresh.reuse_detected',
  'user.created',
  'user.updated',
  'user.credentials_reset',
  'user.unlocked',
  'brand.created',
  'brand.updated',
  'branch.created',
  'branch.updated',
  'menu.category.created',
  'menu.category.updated',
  'menu.category.reordered',
  'menu.item.created',
  'menu.item.updated',
  'menu.item.branch_override_set',
  'menu.modifier_group.created',
  'menu.modifier_group.updated',
  'menu.modifier.created',
  'menu.modifier.updated',
  'menu.combo.created',
  'menu.combo.updated',
  'order.voided',
  'order.line_voided',
  'order.discount_set',
  'order.discount_removed',
  'brand.settings_updated',
  'shift.opened',
  'shift.closed',
  'order.refunded',
  'ingredient.created',
  'ingredient.updated',
  'menu.recipe.updated',
  'inventory.transfer.sent',
  'inventory.transfer.received',
  'inventory.transfer.cancelled',
] as const;

export type AuditAction = (typeof auditActions)[number];

export const auditLogSchema = z.object({
  id: z.uuid(),
  action: z.string(),
  userId: z.uuid().nullable(),
  // The name of the person who did it, when the viewer is allowed to see that person.
  userName: z.string().nullable(),
  brandId: z.uuid().nullable(),
  branchId: z.uuid().nullable(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export type AuditLog = z.infer<typeof auditLogSchema>;

export const auditLogQuerySchema = cursorQuerySchema.extend({
  userId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  action: z.string().min(1).max(100).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
