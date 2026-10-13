import { describe, expect, it } from 'vitest';
import {
  cancelCountRequestSchema,
  saveCountLinesRequestSchema,
  startCountRequestSchema,
} from './counts';

const mall = '01990000-0000-7000-8000-000000000011';
const flour = '01990000-0000-7000-8000-000000009001';
const cheese = '01990000-0000-7000-8000-000000009002';

const codesOf = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`);

describe('a stock count', () => {
  it('starts for every ingredient, or a choice of them, each once', () => {
    expect(startCountRequestSchema.parse({ branchId: mall })).toEqual({ branchId: mall });
    expect(
      startCountRequestSchema.parse({ branchId: mall, ingredientIds: [flour], note: ' ' }),
    ).toEqual({ branchId: mall, ingredientIds: [flour], note: null });
    expect(
      codesOf(startCountRequestSchema.safeParse({ branchId: mall, ingredientIds: [flour, flour] })),
    ).toEqual(['ingredientIds: INGREDIENT_DUPLICATE']);
  });

  it('saves quantities of 0 or more, and null to clear one', () => {
    expect(
      saveCountLinesRequestSchema.parse({
        lines: [
          { ingredientId: flour, counted: '9.5' },
          { ingredientId: cheese, counted: null },
        ],
      }).lines,
    ).toEqual([
      { ingredientId: flour, counted: '9.500' },
      { ingredientId: cheese, counted: null },
    ]);
    expect(
      codesOf(
        saveCountLinesRequestSchema.safeParse({ lines: [{ ingredientId: flour, counted: '-1' }] }),
      ),
    ).toEqual(['lines.0.counted: QUANTITY_INVALID']);
    expect(codesOf(saveCountLinesRequestSchema.safeParse({ lines: [] }))).toEqual([
      'lines: COUNT_LINES_REQUIRED',
    ]);
  });

  it('needs a reason to be cancelled', () => {
    expect(codesOf(cancelCountRequestSchema.safeParse({ reason: '' }))).toEqual([
      'reason: NOTE_REQUIRED',
    ]);
  });
});
