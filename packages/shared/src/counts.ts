import { z } from 'zod';
import { ingredientSchema, quantitySchema } from './inventory';
import { cursorQuerySchema } from './pagination';

// Checking the stock of a branch against what is on the shelves. See docs/specs/015-stock-counts.md.

export const MAX_COUNT_LINES = 500;

export const countStatuses = ['open', 'finished', 'cancelled'] as const;
export const countStatusSchema = z.enum(countStatuses, { error: 'COUNT_STATUS_INVALID' });
export type CountStatus = z.infer<typeof countStatusSchema>;

// ---------------------------------------------------------------------------------------------
// What the API answers

export const countLineSchema = z.object({
  ingredient: ingredientSchema,
  // The stock the system had: when the count started, then when it was finished (rule 4).
  expected: z.string(),
  counted: z.string().nullable(),
  // Counted minus expected, and its value; null until the line is counted.
  difference: z.string().nullable(),
  value: z.string().nullable(),
});
export type CountLine = z.infer<typeof countLineSchema>;

export const stockCountSummarySchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  branchId: z.uuid(),
  status: countStatusSchema,
  note: z.string().nullable(),
  lineCount: z.number().int(),
  countedCount: z.number().int(),
  // What the counted lines lost (0 or below) and found (0 or above), in money (rule 5).
  lostValue: z.string(),
  foundValue: z.string(),
  startedByName: z.string().nullable(),
  startedAt: z.iso.datetime(),
  finishedByName: z.string().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  cancelledByName: z.string().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  cancelReason: z.string().nullable(),
});
export type StockCountSummary = z.infer<typeof stockCountSummarySchema>;

export const stockCountSchema = stockCountSummarySchema.extend({
  lines: z.array(countLineSchema),
});
export type StockCount = z.infer<typeof stockCountSchema>;

// ---------------------------------------------------------------------------------------------
// Requests

export const countListQuerySchema = cursorQuerySchema.extend({
  branchId: z.uuid({ error: 'BRANCH_REQUIRED' }),
  status: countStatusSchema.optional(),
});
export type CountListQuery = z.infer<typeof countListQuerySchema>;

const uniqueIds = (ids: readonly string[]) => new Set(ids).size === ids.length;

export const startCountRequestSchema = z.strictObject({
  branchId: z.uuid({ error: 'BRANCH_REQUIRED' }),
  // None means every active ingredient of the brand (rule 2).
  ingredientIds: z
    .array(z.uuid({ error: 'INGREDIENT_REQUIRED' }))
    .max(MAX_COUNT_LINES, 'COUNT_TOO_LONG')
    .refine(uniqueIds, 'INGREDIENT_DUPLICATE')
    .optional(),
  note: z
    .string({ error: 'NOTE_INVALID' })
    .trim()
    .max(200, 'NOTE_TOO_LONG')
    .transform((text) => (text === '' ? null : text))
    .optional(),
});
export type StartCountRequest = z.infer<typeof startCountRequestSchema>;

export const saveCountLinesRequestSchema = z.strictObject({
  lines: z
    .array(
      z.strictObject({
        ingredientId: z.uuid({ error: 'INGREDIENT_REQUIRED' }),
        // Null clears what was typed.
        counted: quantitySchema.nullable(),
      }),
    )
    .min(1, 'COUNT_LINES_REQUIRED')
    .max(MAX_COUNT_LINES, 'COUNT_TOO_LONG')
    .refine((lines) => uniqueIds(lines.map((line) => line.ingredientId)), 'INGREDIENT_DUPLICATE'),
});
export type SaveCountLinesRequest = z.infer<typeof saveCountLinesRequestSchema>;

export const cancelCountRequestSchema = z.strictObject({
  reason: z
    .string({ error: 'NOTE_REQUIRED' })
    .trim()
    .min(1, 'NOTE_REQUIRED')
    .max(200, 'NOTE_TOO_LONG'),
});
export type CancelCountRequest = z.infer<typeof cancelCountRequestSchema>;
