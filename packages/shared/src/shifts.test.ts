import { describe, expect, it } from 'vitest';
import { systemRoles } from './access';
import { closeShiftRequestSchema, openShiftRequestSchema } from './shifts';

const branchId = '01990000-0000-7000-8000-000000000011';

const codesOf = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`);

describe('shifts', () => {
  it('open with the branch and the cash in the drawer, written with 3 decimals', () => {
    expect(openShiftRequestSchema.parse({ branchId, openingCash: '50' })).toEqual({
      branchId,
      openingCash: '50.000',
    });
    expect(openShiftRequestSchema.parse({ branchId, openingCash: '0' }).openingCash).toBe('0.000');
    expect(codesOf(openShiftRequestSchema.safeParse({ branchId, openingCash: '-5' }))).toEqual([
      'openingCash: CASH_INVALID',
    ]);
    expect(codesOf(openShiftRequestSchema.safeParse({ openingCash: '5' }))).toEqual([
      'branchId: BRANCH_REQUIRED',
    ]);
  });

  it('close with the cash counted and an optional note', () => {
    expect(closeShiftRequestSchema.parse({ countedCash: '57.5', note: ' ' })).toEqual({
      countedCash: '57.500',
      note: null,
    });
    expect(codesOf(closeShiftRequestSchema.safeParse({ countedCash: 'lots' }))).toEqual([
      'countedCash: CASH_INVALID',
    ]);
    expect(
      codesOf(closeShiftRequestSchema.safeParse({ countedCash: '1', note: 'x'.repeat(201) })),
    ).toEqual(['note: NOTE_TOO_LONG']);
  });

  it('are seen by the managers only', () => {
    const can = (key: string) =>
      systemRoles.find((role) => role.key === key)?.permissions.includes('shifts:read');
    expect(can('group_admin')).toBe(true);
    expect(can('brand_manager')).toBe(true);
    expect(can('branch_manager')).toBe(true);
    expect(can('cashier')).toBe(false);
    expect(can('kitchen')).toBe(false);
  });
});
