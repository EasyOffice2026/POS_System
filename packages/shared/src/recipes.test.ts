import { describe, expect, it } from 'vitest';
import { putRecipeRequestSchema } from './recipes';

const flour = '01990000-0000-7000-8000-000000009001';
const cheese = '01990000-0000-7000-8000-000000009002';

const codesOf = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => (result.error?.issues ?? []).map((issue) => `${issue.path.join('.')}: ${issue.message}`);

describe('a recipe', () => {
  it('takes quantities above 0 with 3 decimals, each ingredient once', () => {
    expect(
      putRecipeRequestSchema.parse({
        lines: [
          { ingredientId: flour, quantity: '0.25' },
          { ingredientId: cheese, quantity: '80' },
        ],
      }).lines,
    ).toEqual([
      { ingredientId: flour, quantity: '0.250' },
      { ingredientId: cheese, quantity: '80.000' },
    ]);
    expect(putRecipeRequestSchema.parse({ lines: [] }).lines).toEqual([]);
    expect(
      codesOf(
        putRecipeRequestSchema.safeParse({ lines: [{ ingredientId: flour, quantity: '0' }] }),
      ),
    ).toEqual(['lines.0.quantity: QUANTITY_INVALID']);
    expect(
      codesOf(
        putRecipeRequestSchema.safeParse({
          lines: [
            { ingredientId: flour, quantity: '1' },
            { ingredientId: flour, quantity: '2' },
          ],
        }),
      ),
    ).toEqual(['lines: INGREDIENT_DUPLICATE']);
  });
});
