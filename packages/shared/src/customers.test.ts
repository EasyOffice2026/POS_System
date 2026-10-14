import { describe, expect, it } from 'vitest';
import { type Permission, systemRoles } from './access';
import {
  adjustPointsRequestSchema,
  maxPointsFor,
  normalizePhone,
  pointsEarned,
  pointsValueMils,
  putOrderCustomerRequestSchema,
} from './customers';
import { brandSettingsRequestSchema, defaultLoyaltySettings, parseBrandSettings } from './settings';

const codesOf = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`);

const loyalty = { enabled: true, pointsPerKwd: 1, pointValue: '0.010', minRedeem: 100 };

describe('a customer phone', () => {
  it('is kept as + and digits, a Kuwaiti number when it has eight', () => {
    expect(normalizePhone('9999 1234')).toBe('+96599991234');
    expect(normalizePhone('+965 9999-1234')).toBe('+96599991234');
    expect(normalizePhone('00965 99991234')).toBe('+96599991234');
    expect(normalizePhone('(971) 50 123 4567')).toBe('+971501234567');
    expect(normalizePhone('1234')).toBeNull();
    expect(normalizePhone('call me')).toBeNull();
    expect(codesOf(putOrderCustomerRequestSchema.safeParse({ phone: '12' }))).toEqual([
      'phone: PHONE_INVALID',
    ]);
    expect(putOrderCustomerRequestSchema.parse({ phone: '99991234', name: ' ' })).toEqual({
      phone: '+96599991234',
      name: null,
    });
  });
});

describe('loyalty points', () => {
  it('are earned on the total, rounded down, and only when loyalty is on', () => {
    expect(pointsEarned(28_300, loyalty)).toBe(28);
    expect(pointsEarned(28_300, { ...loyalty, pointsPerKwd: 3 })).toBe(84);
    expect(pointsEarned(28_300, { ...loyalty, enabled: false })).toBe(0);
  });

  it('are worth their value, and no more than pays what is left go on an order', () => {
    expect(pointsValueMils(200, loyalty)).toBe(2000);
    expect(maxPointsFor(8000, loyalty)).toBe(800);
    expect(maxPointsFor(8005, loyalty)).toBe(801);
  });

  it('are given or taken by hand with a reason, never 0', () => {
    expect(codesOf(adjustPointsRequestSchema.safeParse({ points: 0, reason: '' }))).toEqual([
      'points: POINTS_INVALID',
      'reason: NOTE_REQUIRED',
    ]);
    expect(adjustPointsRequestSchema.parse({ points: -50, reason: ' Mistake ' })).toEqual({
      points: -50,
      reason: 'Mistake',
    });
  });

  it('follow the brand settings, off until a manager turns them on', () => {
    expect(parseBrandSettings({}).loyalty).toEqual(defaultLoyaltySettings);
    expect(parseBrandSettings({ loyalty: { ...loyalty, pointValue: 'x' } }).loyalty).toEqual(
      defaultLoyaltySettings,
    );
    const request = {
      paymentMethods: [],
      discountPresets: [],
      cashierDiscountLimit: '0',
      voidNeedsManager: 'never',
      ticketDoneBy: 'kitchen',
      kitchenStations: [],
    };
    expect(brandSettingsRequestSchema.parse(request).loyalty).toEqual(defaultLoyaltySettings);
    expect(
      codesOf(
        brandSettingsRequestSchema.safeParse({
          ...request,
          loyalty: { enabled: true, pointsPerKwd: -1, pointValue: '0', minRedeem: 0 },
        }),
      ),
    ).toEqual([
      'loyalty.pointsPerKwd: POINTS_RATE_INVALID',
      'loyalty.pointValue: PRICE_INVALID',
      'loyalty.minRedeem: POINTS_MIN_INVALID',
    ]);
  });

  it('and the customers are seen by the managers and marketing, changed by the brand', () => {
    const has = (key: string, permission: Permission) =>
      systemRoles.find((role) => role.key === key)?.permissions.includes(permission);
    expect(has('branch_manager', 'customers:read')).toBe(true);
    expect(has('branch_manager', 'customers:write')).toBe(false);
    expect(has('marketing', 'customers:write')).toBe(true);
    expect(has('brand_manager', 'customers:write')).toBe(true);
    expect(has('cashier', 'customers:read')).toBe(false);
  });
});
