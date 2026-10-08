import { auditLogSchema, type AuditLogQuery, pageSchema } from '@pos/shared';
import { request } from '../../lib/api';
import { queryString } from '../../lib/query-string';

export type AuditFilters = Pick<AuditLogQuery, 'action' | 'userId' | 'from' | 'to'>;

export function listAuditPage(filters: AuditFilters, cursor?: string) {
  const query = queryString({ ...filters, limit: 50, cursor });
  return request(`/audit-logs${query}`, { schema: pageSchema(auditLogSchema) });
}
