import { z } from 'zod';
import { ingredientSchema } from './inventory';
import { localizedTextSchema } from './localized';
import { formatMoney } from './money';
import { cursorQuerySchema } from './pagination';

// Stock moved from one branch of a brand to another. See docs/specs/014-stock-transfers.md.

export const MAX_TRANSFER_LINES = 50;

export const transferStatuses = ['sent', 'received', 'cancelled'] as const;
export const transferStatusSchema = z.enum(transferStatuses, { error: 'TRANSFER_STATUS_INVALID' });
export type TransferStatus = z.infer<typeof transferStatusSchema>;

// A quantity above 0 with 3 decimals, in the ingredient's unit.
const transferQuantitySchema = z
  .string({ error: 'QUANTITY_INVALID' })
  .trim()
  .regex(/^\d{1,12}(\.\d{1,3})?$/, 'QUANTITY_INVALID')
  .refine((text) => Number(text) > 0, 'QUANTITY_INVALID')
  .transform(formatMoney);

const reasonField = z
  .string({ error: 'NOTE_REQUIRED' })
  .trim()
  .min(1, 'NOTE_REQUIRED')
  .max(200, 'NOTE_TOO_LONG');

// ---------------------------------------------------------------------------------------------
// What the API answers

const branchRefSchema = z.object({ id: z.uuid(), name: localizedTextSchema });

export const transferLineSchema = z.object({
  ingredient: ingredientSchema,
  quantity: z.string(),
});
export type TransferLine = z.infer<typeof transferLineSchema>;

export const stockTransferSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  brandId: z.uuid(),
  fromBranch: branchRefSchema,
  toBranch: branchRefSchema,
  status: transferStatusSchema,
  note: z.string().nullable(),
  lines: z.array(transferLineSchema),
  sentById: z.uuid().nullable(),
  sentByName: z.string().nullable(),
  sentAt: z.iso.datetime(),
  receivedById: z.uuid().nullable(),
  receivedByName: z.string().nullable(),
  receivedAt: z.iso.datetime().nullable(),
  cancelledById: z.uuid().nullable(),
  cancelledByName: z.string().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  cancelReason: z.string().nullable(),
});
export type StockTransfer = z.infer<typeof stockTransferSchema>;

// ---------------------------------------------------------------------------------------------
// Requests

export const transferListQuerySchema = cursorQuerySchema.extend({
  branchId: z.uuid({ error: 'BRANCH_REQUIRED' }),
  status: transferStatusSchema.optional(),
});
export type TransferListQuery = z.infer<typeof transferListQuerySchema>;

export const transferDestinationsQuerySchema = z.object({
  branchId: z.uuid({ error: 'BRANCH_REQUIRED' }),
});

export const createTransferRequestSchema = z
  .strictObject({
    fromBranchId: z.uuid({ error: 'BRANCH_REQUIRED' }),
    toBranchId: z.uuid({ error: 'BRANCH_REQUIRED' }),
    note: z
      .string({ error: 'NOTE_INVALID' })
      .trim()
      .max(200, 'NOTE_TOO_LONG')
      .transform((text) => (text === '' ? null : text))
      .optional(),
    lines: z
      .array(
        z.strictObject({
          ingredientId: z.uuid({ error: 'INGREDIENT_REQUIRED' }),
          quantity: transferQuantitySchema,
        }),
      )
      .min(1, 'TRANSFER_EMPTY')
      .max(MAX_TRANSFER_LINES, 'TRANSFER_TOO_LONG')
      .refine(
        (lines) => new Set(lines.map((line) => line.ingredientId)).size === lines.length,
        'INGREDIENT_DUPLICATE',
      ),
  })
  .refine((request) => request.fromBranchId !== request.toBranchId, {
    path: ['toBranchId'],
    message: 'TRANSFER_SAME_BRANCH',
  });
export type CreateTransferRequest = z.infer<typeof createTransferRequestSchema>;

export const cancelTransferRequestSchema = z.strictObject({
  reason: reasonField,
});
export type CancelTransferRequest = z.infer<typeof cancelTransferRequestSchema>;
