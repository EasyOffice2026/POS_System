import { describe, expect, it } from 'vitest';
import type { permissions } from './access';
import { systemRoles } from './access';
import { fromMils, percentOfMils, toMils } from './money';
import {
  addOrderLineRequestSchema,
  createOrderRequestSchema,
  setDiscountRequestSchema,
  updateOrderLineRequestSchema,
  updateOrderRequestSchema,
  voidRequestSchema,
} from './orders';

const id = '01990000-0000-7000-8000-000000000501';
const other = '01990000-0000-7000-8000-000000000502';

const codesOf = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`);

describe('money in thousandths', () => {
  it('reads text into whole thousandths and writes it back', () => {
    expect(toMils('12.500')).toBe(12500);
    expect(toMils('12.5')).toBe(12500);
    expect(toMils('7')).toBe(7000);
    expect(toMils('-5.000')).toBe(-5000);
    expect(toMils('0.001')).toBe(1);
    expect(fromMils(12500)).toBe('12.500');
    expect(fromMils(1)).toBe('0.001');
    expect(fromMils(-5000)).toBe('-5.000');
    expect(fromMils(0)).toBe('0.000');
  });

  it('adds prices without the rounding errors of decimal numbers', () => {
    expect(fromMils(toMils('0.100') + toMils('0.200'))).toBe('0.300');
    expect(fromMils(toMils('9999999.999') * 99 * 200)).toBe('197999999980.200');
  });

  it('refuses text that is not money, and a number that is not whole', () => {
    expect(() => toMils('abc')).toThrow(RangeError);
    expect(() => toMils('1.2345')).toThrow(RangeError);
    expect(() => fromMils(1.5)).toThrow(RangeError);
  });

  it('works out a percentage rounded to the nearest thousandth, a half going up', () => {
    expect(percentOfMils(50000, '10.00')).toBe(5000);
    expect(percentOfMils(80000, '10')).toBe(8000);
    expect(percentOfMils(10001, '12.5')).toBe(1250);
    expect(percentOfMils(3, '50')).toBe(2);
    expect(percentOfMils(12345, '100.00')).toBe(12345);
    expect(percentOfMils(197999999980200, '33.33')).toBe(65993399993401);
  });
});

describe('order permissions', () => {
  const holders = (permission: (typeof permissions)[number]) =>
    systemRoles.filter((role) => role.permissions.includes(permission)).map((role) => role.key);

  it('lets cashiers open orders, and only managers void or give discounts', () => {
    expect(holders('orders:write')).toEqual([
      'group_admin',
      'brand_manager',
      'branch_manager',
      'cashier',
    ]);
    expect(holders('orders:void')).toEqual(['group_admin', 'brand_manager', 'branch_manager']);
    expect(holders('orders:discount')).toEqual(['group_admin', 'brand_manager', 'branch_manager']);
  });

  it('lets the kitchen see orders without changing them', () => {
    expect(holders('orders:read')).toContain('kitchen');
    expect(holders('orders:write')).not.toContain('kitchen');
  });
});

describe('createOrderRequestSchema', () => {
  it('takes a branch and a type, and an id made on the terminal', () => {
    expect(createOrderRequestSchema.parse({ branchId: id, type: 'dine_in' })).toEqual({
      branchId: id,
      type: 'dine_in',
    });
    expect(createOrderRequestSchema.parse({ id: other, branchId: id, type: 'takeaway' }).id).toBe(
      other,
    );
  });

  it('says what is wrong with an unknown type, a missing branch or an unknown field', () => {
    expect(codesOf(createOrderRequestSchema.safeParse({ branchId: id, type: 'delivery' }))).toEqual(
      ['type: ORDER_TYPE_INVALID'],
    );
    expect(codesOf(createOrderRequestSchema.safeParse({ type: 'takeaway' }))).toEqual([
      'branchId: BRANCH_REQUIRED',
    ]);
    expect(
      createOrderRequestSchema.safeParse({ branchId: id, type: 'takeaway', total: '0' }).success,
    ).toBe(false);
  });

  it('keeps a note of up to 200 characters, and an empty note as none', () => {
    expect(
      createOrderRequestSchema.parse({ branchId: id, type: 'takeaway', note: '  ' }).note,
    ).toBeNull();
    expect(
      codesOf(
        createOrderRequestSchema.safeParse({
          branchId: id,
          type: 'takeaway',
          note: 'x'.repeat(201),
        }),
      ),
    ).toEqual(['note: NOTE_TOO_LONG']);
  });
});

describe('updateOrderRequestSchema', () => {
  it('needs something to change', () => {
    expect(codesOf(updateOrderRequestSchema.safeParse({}))).toEqual([': NOTHING_TO_UPDATE']);
    expect(updateOrderRequestSchema.parse({ note: null })).toEqual({ note: null });
  });
});

describe('addOrderLineRequestSchema', () => {
  it('takes a dish with its modifiers, one by default', () => {
    expect(
      addOrderLineRequestSchema.parse({ kind: 'item', itemId: id, modifierIds: [other] }),
    ).toEqual({
      kind: 'item',
      itemId: id,
      quantity: 1,
      modifierIds: [other],
    });
  });

  it('takes a combo with one choice per slot', () => {
    const line = addOrderLineRequestSchema.parse({
      kind: 'combo',
      comboId: id,
      quantity: 2,
      choices: [{ slotId: other, itemId: id }],
    });

    expect(line).toMatchObject({
      kind: 'combo',
      quantity: 2,
      choices: [{ slotId: other, itemId: id, modifierIds: [] }],
    });
  });

  it.each([0, 100, 1.5, '2'])('refuses the quantity %s', (quantity) => {
    expect(
      codesOf(addOrderLineRequestSchema.safeParse({ kind: 'item', itemId: id, quantity })),
    ).toEqual(['quantity: QUANTITY_INVALID']);
  });

  it('refuses the same modifier twice, and the same slot twice', () => {
    expect(
      codesOf(
        addOrderLineRequestSchema.safeParse({
          kind: 'item',
          itemId: id,
          modifierIds: [other, other],
        }),
      ),
    ).toEqual(['modifierIds: MODIFIER_DUPLICATE']);
    expect(
      codesOf(
        addOrderLineRequestSchema.safeParse({
          kind: 'combo',
          comboId: id,
          choices: [
            { slotId: other, itemId: id },
            { slotId: other, itemId: other },
          ],
        }),
      ),
    ).toEqual(['choices: SLOT_CHOSEN_TWICE']);
  });

  it('refuses a line of an unknown kind', () => {
    expect(addOrderLineRequestSchema.safeParse({ kind: 'drink', itemId: id }).success).toBe(false);
  });
});

describe('updateOrderLineRequestSchema', () => {
  it('changes the quantity or the note', () => {
    expect(updateOrderLineRequestSchema.parse({ quantity: 3 })).toEqual({ quantity: 3 });
    expect(codesOf(updateOrderLineRequestSchema.safeParse({}))).toEqual([': NOTHING_TO_UPDATE']);
  });
});

describe('voidRequestSchema', () => {
  it('needs a reason, and takes a manager approval', () => {
    expect(codesOf(voidRequestSchema.safeParse({ reason: ' ' }))).toEqual([
      'reason: REASON_REQUIRED',
    ]);
    expect(
      voidRequestSchema.parse({
        reason: 'Guest left',
        approval: { staffCode: ' 9001 ', pin: '7391' },
      }),
    ).toEqual({ reason: 'Guest left', approval: { staffCode: '9001', pin: '7391' } });
  });
});

describe('setDiscountRequestSchema', () => {
  it('writes a percentage with 2 decimals and an amount with 3', () => {
    expect(
      setDiscountRequestSchema.parse({ kind: 'percent', value: '10', reason: 'Regular' }).value,
    ).toBe('10.00');
    expect(
      setDiscountRequestSchema.parse({ kind: 'percent', value: '12.5', reason: 'R' }).value,
    ).toBe('12.50');
    expect(setDiscountRequestSchema.parse({ kind: 'amount', value: '5', reason: 'R' }).value).toBe(
      '5.000',
    );
  });

  it.each([
    ['percent', '0'],
    ['percent', '100.01'],
    ['percent', '12.345'],
    ['percent', 'ten'],
    ['amount', '0'],
    ['amount', '-5'],
    ['amount', '1.2345'],
  ])('refuses a %s discount of %s', (kind, value) => {
    expect(codesOf(setDiscountRequestSchema.safeParse({ kind, value, reason: 'R' }))).toEqual([
      'value: DISCOUNT_VALUE_INVALID',
    ]);
  });

  it('accepts the whole order free', () => {
    expect(
      setDiscountRequestSchema.parse({ kind: 'percent', value: '100', reason: 'R' }).value,
    ).toBe('100.00');
  });
});
