import { describe, expect, it } from 'vitest';
import { cancelTransferRequestSchema, createTransferRequestSchema } from './transfers';

const mall = '01990000-0000-7000-8000-000000000011';
const downtown = '01990000-0000-7000-8000-000000000012';
const flour = '01990000-0000-7000-8000-000000009001';

const codesOf = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`);

describe('a transfer', () => {
  it('goes from one branch to another with quantities above 0', () => {
    const sent = createTransferRequestSchema.parse({
      fromBranchId: downtown,
      toBranchId: mall,
      note: ' For the weekend ',
      lines: [{ ingredientId: flour, quantity: '2.5' }],
    });
    expect(sent.note).toBe('For the weekend');
    expect(sent.lines).toEqual([{ ingredientId: flour, quantity: '2.500' }]);
  });

  it('refuses the same branch, no lines, a zero and a doubled ingredient', () => {
    expect(
      codesOf(
        createTransferRequestSchema.safeParse({
          fromBranchId: mall,
          toBranchId: mall,
          lines: [{ ingredientId: flour, quantity: '1' }],
        }),
      ),
    ).toEqual(['toBranchId: TRANSFER_SAME_BRANCH']);
    expect(
      codesOf(
        createTransferRequestSchema.safeParse({
          fromBranchId: downtown,
          toBranchId: mall,
          lines: [],
        }),
      ),
    ).toEqual(['lines: TRANSFER_EMPTY']);
    expect(
      codesOf(
        createTransferRequestSchema.safeParse({
          fromBranchId: downtown,
          toBranchId: mall,
          lines: [{ ingredientId: flour, quantity: '0' }],
        }),
      ),
    ).toEqual(['lines.0.quantity: QUANTITY_INVALID']);
    expect(
      codesOf(
        createTransferRequestSchema.safeParse({
          fromBranchId: downtown,
          toBranchId: mall,
          lines: [
            { ingredientId: flour, quantity: '1' },
            { ingredientId: flour, quantity: '2' },
          ],
        }),
      ),
    ).toEqual(['lines: INGREDIENT_DUPLICATE']);
  });

  it('needs a reason to be cancelled', () => {
    expect(codesOf(cancelTransferRequestSchema.safeParse({ reason: '  ' }))).toEqual([
      'reason: NOTE_REQUIRED',
    ]);
    expect(cancelTransferRequestSchema.parse({ reason: ' Sent by mistake ' }).reason).toBe(
      'Sent by mistake',
    );
  });
});
