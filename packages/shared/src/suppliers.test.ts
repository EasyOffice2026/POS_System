import { describe, expect, it } from 'vitest';
import { type Permission, systemRoles } from './access';
import {
  createSupplierRequestSchema,
  putSupplierPricesRequestSchema,
  updateSupplierRequestSchema,
} from './suppliers';

const flour = '01990000-0000-7000-8000-000000009001';

const codesOf = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`);

describe('a supplier', () => {
  it('needs a name; contact details are optional and blank means none', () => {
    expect(
      createSupplierRequestSchema.parse({
        name: ' Gulf Dairy ',
        phone: '+965 2222-3333',
        email: ' Orders@GulfDairy.KW ',
        contactName: ' ',
      }),
    ).toEqual({
      name: 'Gulf Dairy',
      phone: '+965 2222-3333',
      email: 'orders@gulfdairy.kw',
      contactName: null,
      paymentDays: 0,
    });
    expect(codesOf(createSupplierRequestSchema.safeParse({ name: ' ' }))).toEqual([
      'name: SUPPLIER_NAME_REQUIRED',
    ]);
  });

  it('refuses a phone with letters, an email that is not one, and days outside 0 to 365', () => {
    expect(
      codesOf(
        createSupplierRequestSchema.safeParse({
          name: 'X',
          phone: 'call me',
          email: 'nope',
          paymentDays: 400,
        }),
      ),
    ).toEqual([
      'phone: PHONE_INVALID',
      'email: EMAIL_INVALID',
      'paymentDays: PAYMENT_DAYS_INVALID',
    ]);
    expect(codesOf(updateSupplierRequestSchema.safeParse({}))).toEqual([': NOTHING_TO_UPDATE']);
  });

  it('has a price list with each ingredient once', () => {
    expect(
      putSupplierPricesRequestSchema.parse({ prices: [{ ingredientId: flour, price: '0.35' }] })
        .prices,
    ).toEqual([{ ingredientId: flour, price: '0.350' }]);
    expect(
      codesOf(
        putSupplierPricesRequestSchema.safeParse({
          prices: [
            { ingredientId: flour, price: '1' },
            { ingredientId: flour, price: '2' },
          ],
        }),
      ),
    ).toEqual(['prices: INGREDIENT_DUPLICATE']);
  });

  it('is changed by the group admin and the brand manager only', () => {
    const has = (key: string, permission: Permission) =>
      systemRoles.find((role) => role.key === key)?.permissions.includes(permission);
    expect(has('group_admin', 'suppliers:write')).toBe(true);
    expect(has('brand_manager', 'suppliers:write')).toBe(true);
    expect(has('purchaser', 'suppliers:write')).toBe(false);
    expect(has('branch_manager', 'suppliers:write')).toBe(false);
  });
});
