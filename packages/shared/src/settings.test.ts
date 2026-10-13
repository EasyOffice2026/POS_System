import { describe, expect, it } from 'vitest';
import { systemRoles } from './access';
import {
  brandSettingsRequestSchema,
  defaultBrandSettings,
  parseBrandSettings,
  voidNeedsApproval,
  withinCashierLimit,
} from './settings';

const codesOf = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`);

const station = '01990000-0000-7000-8000-000000000b01';

describe('brand settings', () => {
  it('fall back to the defaults part by part', () => {
    expect(parseBrandSettings(null)).toEqual(defaultBrandSettings);
    expect(parseBrandSettings({ voidNeedsManager: 'always', discountPresets: 'nope' })).toEqual({
      ...defaultBrandSettings,
      voidNeedsManager: 'always',
    });
  });

  it('accept a whole settings request, tidy the keys and sort the buttons', () => {
    const parsed = brandSettingsRequestSchema.parse({
      paymentMethods: [
        { key: ' KNET ', name: { en: 'KNET', ar: 'كي نت' } },
        { key: 'talabat', name: { en: 'Talabat', ar: 'طلبات' }, isActive: false },
      ],
      discountPresets: ['50', '5', '12.5'],
      cashierDiscountLimit: '10',
      voidNeedsManager: 'after_send',
      ticketDoneBy: 'cashier',
      kitchenStations: [
        { id: station, name: { en: 'Pizza', ar: 'بيتزا' } },
        { name: { en: 'Drinks', ar: 'مشروبات' } },
      ],
    });
    expect(parsed.paymentMethods).toEqual([
      { key: 'knet', name: { en: 'KNET', ar: 'كي نت' }, isActive: true },
      { key: 'talabat', name: { en: 'Talabat', ar: 'طلبات' }, isActive: false },
    ]);
    expect(parsed.discountPresets).toEqual(['5.00', '12.50', '50.00']);
    expect(parsed.cashierDiscountLimit).toBe('10.00');
    expect(parsed.kitchenStations[1]?.id).toBeUndefined();
  });

  it('refuse cash as a method key, the same key twice, and a percentage above 100', () => {
    const base = { ...defaultBrandSettings, kitchenStations: [] };
    expect(
      codesOf(
        brandSettingsRequestSchema.safeParse({
          ...base,
          paymentMethods: [{ key: 'cash', name: { en: 'Cash', ar: 'نقد' } }],
        }),
      ),
    ).toEqual(['paymentMethods.0.key: PAYMENT_METHOD_KEY_INVALID']);
    expect(
      codesOf(
        brandSettingsRequestSchema.safeParse({
          ...base,
          paymentMethods: [
            { key: 'knet', name: { en: 'A', ar: 'أ' } },
            { key: 'knet', name: { en: 'B', ar: 'ب' } },
          ],
        }),
      ),
    ).toEqual(['paymentMethods: PAYMENT_METHOD_KEY_TAKEN']);
    expect(
      codesOf(brandSettingsRequestSchema.safeParse({ ...base, cashierDiscountLimit: '101' })),
    ).toEqual(['cashierDiscountLimit: PERCENT_INVALID']);
  });

  it('decide when a cashier needs a manager', () => {
    const limit10 = { ...defaultBrandSettings, cashierDiscountLimit: '10.00' };
    expect(withinCashierLimit(limit10, { kind: 'percent', value: '10.00' })).toBe(true);
    expect(withinCashierLimit(limit10, { kind: 'percent', value: '15.00' })).toBe(false);
    expect(withinCashierLimit(limit10, { kind: 'amount', value: '1.000' })).toBe(false);
    expect(withinCashierLimit(defaultBrandSettings, { kind: 'percent', value: '5.00' })).toBe(
      false,
    );

    expect(voidNeedsApproval({ ...defaultBrandSettings, voidNeedsManager: 'never' }, true)).toBe(
      false,
    );
    expect(
      voidNeedsApproval({ ...defaultBrandSettings, voidNeedsManager: 'after_send' }, false),
    ).toBe(false);
    expect(
      voidNeedsApproval({ ...defaultBrandSettings, voidNeedsManager: 'after_send' }, true),
    ).toBe(true);
    expect(voidNeedsApproval({ ...defaultBrandSettings, voidNeedsManager: 'always' }, false)).toBe(
      true,
    );
  });

  it('can be changed by the group admin and the brand manager only', () => {
    const can = (key: string) =>
      systemRoles.find((role) => role.key === key)?.permissions.includes('settings:write');
    expect(can('group_admin')).toBe(true);
    expect(can('brand_manager')).toBe(true);
    expect(can('branch_manager')).toBe(false);
    expect(can('cashier')).toBe(false);
  });
});
