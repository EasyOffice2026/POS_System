import { describe, expect, it } from 'vitest';
import { systemRoles } from './access';
import { refundRequestSchema } from './refunds';

const id = '01990000-0000-7000-8000-00000000f001';

const codesOf = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`);

describe('refunds', () => {
  it('take an amount above 0 written with 3 decimals, a way back and a reason', () => {
    expect(
      refundRequestSchema.parse({ id, amount: '7.5', method: 'knet', reason: ' Cold ' }),
    ).toEqual({ id, amount: '7.500', method: 'knet', reason: 'Cold' });
    expect(
      codesOf(refundRequestSchema.safeParse({ id, amount: '0', method: 'cash', reason: 'x' })),
    ).toEqual(['amount: REFUND_AMOUNT_INVALID']);
    expect(codesOf(refundRequestSchema.safeParse({ id, amount: '1', method: 'cash' }))).toEqual([
      'reason: REASON_REQUIRED',
    ]);
  });

  it('are a right of the managers; a cashier needs a manager', () => {
    const can = (key: string) =>
      systemRoles.find((role) => role.key === key)?.permissions.includes('orders:refund');
    expect(can('brand_manager')).toBe(true);
    expect(can('branch_manager')).toBe(true);
    expect(can('cashier')).toBe(false);
  });
});
