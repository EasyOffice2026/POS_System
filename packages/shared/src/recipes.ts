import { z } from 'zod';
import { ingredientSchema } from './inventory';
import { formatMoney } from './money';

// What a dish or a modifier uses, and the stock taken off by sales. See docs/specs/013-recipes.md.

export const MAX_RECIPE_LINES = 50;

// A quantity above 0 in the ingredient's unit, with 3 decimals.
const recipeQuantitySchema = z
  .string({ error: 'QUANTITY_INVALID' })
  .trim()
  .regex(/^\d{1,9}(\.\d{1,3})?$/, 'QUANTITY_INVALID')
  .transform(formatMoney)
  .refine((quantity) => Number(quantity) > 0, 'QUANTITY_INVALID');

export const recipeLineSchema = z.object({
  ingredient: ingredientSchema,
  quantity: z.string(),
  // Quantity times the ingredient's cost (rule 6).
  cost: z.string(),
});
export type RecipeLine = z.infer<typeof recipeLineSchema>;

export const recipeSchema = z.object({
  lines: z.array(recipeLineSchema),
  cost: z.string(),
});
export type Recipe = z.infer<typeof recipeSchema>;

// Replaces the recipe as a whole (rule 1).
export const putRecipeRequestSchema = z.strictObject({
  lines: z
    .array(
      z.strictObject({
        ingredientId: z.uuid({ error: 'INGREDIENT_REQUIRED' }),
        quantity: recipeQuantitySchema,
      }),
    )
    .max(MAX_RECIPE_LINES, 'RECIPE_TOO_LONG')
    .refine(
      (lines) => new Set(lines.map((line) => line.ingredientId)).size === lines.length,
      'INGREDIENT_DUPLICATE',
    ),
});
export type PutRecipeRequest = z.infer<typeof putRecipeRequestSchema>;
