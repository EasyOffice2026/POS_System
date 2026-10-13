import { describe, expect, it } from 'vitest';
import { type Permission, systemRoles } from './access';
import {
  createIngredientRequestSchema,
  createMovementRequestSchema,
  updateIngredientRequestSchema,
} from './inventory';

const branchId = '01990000-0000-7000-8000-000000000011';
const ingredientId = '01990000-0000-7000-8000-000000009001';
const name = { en: 'Flour', ar: 'طحين' };

const codesOf = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`);

describe('ingredients', () => {
  it('need a name in both languages and a unit, and start at no cost and no low level', () => {
    expect(createIngredientRequestSchema.parse({ name, unit: 'kg' })).toEqual({
      name,
      unit: 'kg',
      costPerUnit: '0.000',
      lowLevel: '0.000',
      isActive: true,
    });
    expect(codesOf(createIngredientRequestSchema.safeParse({ name, unit: 'box' }))).toEqual([
      'unit: UNIT_INVALID',
    ]);
    expect(
      codesOf(createIngredientRequestSchema.safeParse({ name, unit: 'kg', lowLevel: '-1' })),
    ).toEqual(['lowLevel: QUANTITY_INVALID']);
    expect(codesOf(updateIngredientRequestSchema.safeParse({}))).toEqual([': NOTHING_TO_UPDATE']);
  });
});

describe('movements recorded by hand', () => {
  const base = { branchId, ingredientId };

  it('take goods received without a note, and waste and corrections with one', () => {
    expect(
      createMovementRequestSchema.parse({ ...base, kind: 'received', quantity: '20' }).quantity,
    ).toBe('20.000');
    expect(
      codesOf(createMovementRequestSchema.safeParse({ ...base, kind: 'waste', quantity: '2.5' })),
    ).toEqual(['note: NOTE_REQUIRED']);
    expect(
      createMovementRequestSchema.parse({
        ...base,
        kind: 'adjustment',
        quantity: '0',
        note: 'Counted',
      }).quantity,
    ).toBe('0.000');
  });

  it('refuse nothing received or wasted, and a kind the system records itself', () => {
    expect(
      codesOf(createMovementRequestSchema.safeParse({ ...base, kind: 'received', quantity: '0' })),
    ).toEqual(['quantity: QUANTITY_INVALID']);
    expect(
      codesOf(
        createMovementRequestSchema.safeParse({ ...base, kind: 'sold', quantity: '1', note: 'x' }),
      ),
    ).toEqual(['kind: MOVEMENT_KIND_INVALID']);
  });

  it('are for the managers and the purchaser; the list is for the brand', () => {
    const has = (key: string, permission: Permission) =>
      systemRoles.find((role) => role.key === key)?.permissions.includes(permission);
    expect(has('purchaser', 'inventory:write')).toBe(true);
    expect(has('purchaser', 'ingredients:write')).toBe(false);
    expect(has('branch_manager', 'inventory:write')).toBe(true);
    expect(has('branch_manager', 'ingredients:write')).toBe(false);
    expect(has('brand_manager', 'ingredients:write')).toBe(true);
    expect(has('cashier', 'inventory:read')).toBe(false);
  });
});
