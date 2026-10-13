import { z } from 'zod';
import { localizedNameSchema, localizedTextSchema } from './localized';
import { menuStatusSchema } from './menu';
import { formatMoney, priceSchema } from './money';
import { cursorQuerySchema } from './pagination';
import { searchQuerySchema } from './search';

// A brand's ingredients and the stock of each branch. See docs/specs/012-ingredients-and-stock.md.

export const stockUnits = ['g', 'kg', 'ml', 'l', 'piece'] as const;
export const stockUnitSchema = z.enum(stockUnits, { error: 'UNIT_INVALID' });
export type StockUnit = z.infer<typeof stockUnitSchema>;

// What a movement is: goods received, a correction to what was counted, waste; later sales,
// transfers and counts.
export const movementKinds = [
  'received',
  'adjustment',
  'waste',
  'sold',
  'transfer_in',
  'transfer_out',
  'count',
] as const;
export const movementKindSchema = z.enum(movementKinds, { error: 'MOVEMENT_KIND_INVALID' });
export type MovementKind = z.infer<typeof movementKindSchema>;

// The kinds a person records by hand (rule 3).
export const manualMovementKindSchema = z.enum(['received', 'adjustment', 'waste'], {
  error: 'MOVEMENT_KIND_INVALID',
});

// A quantity of stock: 0 or more, with 3 decimals ("2.500" kg).
const quantityText = /^\d{1,12}(\.\d{1,3})?$/;
export const quantitySchema = z
  .string({ error: 'QUANTITY_INVALID' })
  .trim()
  .regex(quantityText, 'QUANTITY_INVALID')
  .transform(formatMoney);

const noteField = z
  .string({ error: 'NOTE_INVALID' })
  .trim()
  .max(200, 'NOTE_TOO_LONG')
  .transform((text) => (text === '' ? null : text));

// ---------------------------------------------------------------------------------------------
// What the API answers

export const ingredientSchema = z.object({
  id: z.uuid(),
  brandId: z.uuid(),
  name: localizedTextSchema,
  unit: stockUnitSchema,
  costPerUnit: z.string(),
  // The brand's default: a branch is low at or below this (rule 5).
  lowLevel: z.string(),
  isActive: z.boolean(),
});
export type Ingredient = z.infer<typeof ingredientSchema>;

// The stock of one ingredient at a branch.
export const branchStockSchema = z.object({
  branchId: z.uuid(),
  ingredient: ingredientSchema,
  quantity: z.string(),
  // The branch's own low level, or null for the brand's default.
  lowLevel: z.string().nullable(),
  isLow: z.boolean(),
  // Quantity times the cost of a unit (rule 6).
  value: z.string(),
});
export type BranchStock = z.infer<typeof branchStockSchema>;

export const stockMovementSchema = z.object({
  id: z.uuid(),
  branchId: z.uuid(),
  ingredientId: z.uuid(),
  kind: movementKindSchema,
  // Negative when stock leaves.
  quantity: z.string(),
  quantityAfter: z.string(),
  note: z.string().nullable(),
  // The order or transfer it came from, later.
  referenceId: z.uuid().nullable(),
  byId: z.uuid().nullable(),
  byName: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type StockMovement = z.infer<typeof stockMovementSchema>;

// ---------------------------------------------------------------------------------------------
// Requests

export const ingredientListQuerySchema = z.object({
  brandId: z.uuid().optional(),
  q: searchQuerySchema.optional(),
  status: menuStatusSchema.optional(),
});
export type IngredientListQuery = z.infer<typeof ingredientListQuerySchema>;

export const createIngredientRequestSchema = z.strictObject({
  brandId: z.uuid().optional(),
  name: localizedNameSchema,
  unit: stockUnitSchema,
  costPerUnit: priceSchema.default('0.000'),
  lowLevel: quantitySchema.default('0.000'),
  isActive: z.boolean().default(true),
});
export type CreateIngredientRequest = z.infer<typeof createIngredientRequestSchema>;

export const updateIngredientRequestSchema = z
  .strictObject({
    name: localizedNameSchema.optional(),
    unit: stockUnitSchema.optional(),
    costPerUnit: priceSchema.optional(),
    lowLevel: quantitySchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((request) => Object.keys(request).length > 0, { message: 'NOTHING_TO_UPDATE' });
export type UpdateIngredientRequest = z.infer<typeof updateIngredientRequestSchema>;

export const stockListQuerySchema = z.object({
  branchId: z.uuid({ error: 'BRANCH_REQUIRED' }),
  low: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
export type StockListQuery = z.infer<typeof stockListQuerySchema>;

export const setLowLevelRequestSchema = z.strictObject({
  lowLevel: quantitySchema.nullable(),
});
export type SetLowLevelRequest = z.infer<typeof setLowLevelRequestSchema>;

// A movement recorded by hand: what came in, what was counted, or what was thrown away (rule 3).
export const createMovementRequestSchema = z
  .strictObject({
    branchId: z.uuid({ error: 'BRANCH_REQUIRED' }),
    ingredientId: z.uuid({ error: 'INGREDIENT_REQUIRED' }),
    kind: manualMovementKindSchema,
    quantity: quantitySchema,
    note: noteField.optional(),
  })
  .superRefine((request, ctx) => {
    if (request.kind !== 'adjustment' && Number(request.quantity) <= 0) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'QUANTITY_INVALID' });
    }
    if (request.kind !== 'received' && !request.note) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'NOTE_REQUIRED' });
    }
  });
export type CreateMovementRequest = z.infer<typeof createMovementRequestSchema>;

export const movementListQuerySchema = cursorQuerySchema.extend({
  branchId: z.uuid({ error: 'BRANCH_REQUIRED' }),
  ingredientId: z.uuid().optional(),
});
export type MovementListQuery = z.infer<typeof movementListQuerySchema>;
