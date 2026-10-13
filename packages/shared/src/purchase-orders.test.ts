import { describe, expect, it } from 'vitest';
import {
  cancelPurchaseOrderRequestSchema,
  createPurchaseOrderRequestSchema,
  updatePurchaseOrderRequestSchema,
} from './purchase-orders';

const mall = '01990000-0000-7000-8000-000000000011';
const dairy = '01990000-0000-7000-8000-00000000d001';
const cheese = '01990000-0000-7000-8000-000000009002';

const codesOf = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`);

describe('a purchase order', () => {
  it('has lines with a quantity above 0 and a price that may be left out', () => {
    expect(
      createPurchaseOrderRequestSchema.parse({
        branchId: mall,
        supplierId: dairy,
        expectedOn: '2026-10-20',
        note: ' ',
        lines: [{ ingredientId: cheese, quantity: '10' }],
      }),
    ).toEqual({
      branchId: mall,
      supplierId: dairy,
      expectedOn: '2026-10-20',
      note: null,
      lines: [{ ingredientId: cheese, quantity: '10.000' }],
    });
    expect(
      updatePurchaseOrderRequestSchema.parse({
        lines: [{ ingredientId: cheese, quantity: '1.5', unitPrice: '2.8' }],
      }).lines,
    ).toEqual([{ ingredientId: cheese, quantity: '1.500', unitPrice: '2.800' }]);
  });

  it('refuses no lines, a quantity of 0, an ingredient twice and a day that is not one', () => {
    expect(codesOf(updatePurchaseOrderRequestSchema.safeParse({ lines: [] }))).toEqual([
      'lines: ORDER_EMPTY',
    ]);
    expect(
      codesOf(
        updatePurchaseOrderRequestSchema.safeParse({
          expectedOn: '20/10/2026',
          lines: [
            { ingredientId: cheese, quantity: '0' },
            { ingredientId: cheese, quantity: '1' },
          ],
        }),
      ),
    ).toEqual([
      'expectedOn: DATE_INVALID',
      'lines.0.quantity: QUANTITY_INVALID',
      'lines: INGREDIENT_DUPLICATE',
    ]);
  });

  it('needs a reason to be cancelled', () => {
    expect(codesOf(cancelPurchaseOrderRequestSchema.safeParse({ reason: ' ' }))).toEqual([
      'reason: NOTE_REQUIRED',
    ]);
  });
});
