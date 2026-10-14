import { describe, expect, it } from 'vitest';
import { type Permission, systemRoles } from './access';
import { salesReportQuerySchema } from './reports';

const codesOf = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`);

describe('the sales report', () => {
  it('covers one day up to 92, the last one included', () => {
    expect(salesReportQuerySchema.safeParse({ from: '2026-10-14', to: '2026-10-14' }).success).toBe(
      true,
    );
    expect(salesReportQuerySchema.safeParse({ from: '2026-07-15', to: '2026-10-14' }).success).toBe(
      true,
    );
    expect(
      codesOf(salesReportQuerySchema.safeParse({ from: '2026-07-14', to: '2026-10-14' })),
    ).toEqual(['to: RANGE_TOO_LONG']);
    expect(
      codesOf(salesReportQuerySchema.safeParse({ from: '2026-10-14', to: '2026-10-13' })),
    ).toEqual(['to: RANGE_INVALID']);
    expect(
      codesOf(salesReportQuerySchema.safeParse({ from: '14/10/2026', to: '2026-10-14' })),
    ).toEqual(['from: DATE_INVALID']);
  });

  it('is for the managers, not for the cashier, the kitchen or the purchaser', () => {
    const has = (key: string, permission: Permission) =>
      systemRoles.find((role) => role.key === key)?.permissions.includes(permission);
    expect(has('group_admin', 'reports:read')).toBe(true);
    expect(has('brand_manager', 'reports:read')).toBe(true);
    expect(has('branch_manager', 'reports:read')).toBe(true);
    expect(has('cashier', 'reports:read')).toBe(false);
    expect(has('purchaser', 'reports:read')).toBe(false);
  });
});
