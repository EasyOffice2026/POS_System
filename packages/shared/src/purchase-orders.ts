import { z } from 'zod';
import { ingredientSchema, quantitySchema } from './inventory';
import { localizedTextSchema } from './localized';
import { priceSchema } from './money';
import { cursorQuerySchema } from './pagination';

// Ingredients ordered for a branch from a supplier. See docs/specs/018-purchase-orders.md.

export const MAX_PURCHASE_ORDER_LINES = 200;

export const purchaseOrderStatuses = ['draft', 'sent', 'received', 'cancelled'] as const;
export const purchaseOrderStatusSchema = z.enum(purchaseOrderStatuses, {
  error: 'ORDER_STATUS_INVALID',
});
export type PurchaseOrderStatus = z.infer<typeof purchaseOrderStatusSchema>;

// ---------------------------------------------------------------------------------------------
// What the API answers

export const purchaseOrderSummarySchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  brandId: z.uuid(),
  branchId: z.uuid(),
  supplier: z.object({ id: z.uuid(), name: z.string() }),
  status: purchaseOrderStatusSchema,
  expectedOn: z.iso.date().nullable(),
  note: z.string().nullable(),
  total: z.string(),
  lineCount: z.number().int(),
  createdByName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  sentByName: z.string().nullable(),
  sentAt: z.iso.datetime().nullable(),
  cancelledByName: z.string().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  cancelReason: z.string().nullable(),
});
export type PurchaseOrderSummary = z.infer<typeof purchaseOrderSummarySchema>;

export const purchaseOrderLineSchema = z.object({
  ingredient: ingredientSchema,
  quantity: z.string(),
  unitPrice: z.string(),
  lineTotal: z.string(),
});
export type PurchaseOrderLine = z.infer<typeof purchaseOrderLineSchema>;

export const purchaseOrderSchema = purchaseOrderSummarySchema.extend({
  // Who to give the order to, and where it goes, for the printed order.
  supplier: z.object({
    id: z.uuid(),
    name: z.string(),
    contactName: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  }),
  branch: z.object({ id: z.uuid(), name: localizedTextSchema, address: z.string().nullable() }),
  lines: z.array(purchaseOrderLineSchema),
});
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;

// ---------------------------------------------------------------------------------------------
// Requests

export const purchaseOrderListQuerySchema = cursorQuerySchema.extend({
  branchId: z.uuid({ error: 'BRANCH_REQUIRED' }),
  status: purchaseOrderStatusSchema.optional(),
});
export type PurchaseOrderListQuery = z.infer<typeof purchaseOrderListQuerySchema>;

const positiveQuantitySchema = quantitySchema.refine(
  (text) => Number(text) > 0,
  'QUANTITY_INVALID',
);

const orderContent = {
  expectedOn: z.iso.date({ error: 'DATE_INVALID' }).nullable().optional(),
  note: z
    .string({ error: 'NOTE_INVALID' })
    .trim()
    .max(500, 'NOTE_TOO_LONG')
    .transform((text) => (text === '' ? null : text))
    .optional(),
  lines: z
    .array(
      z.strictObject({
        ingredientId: z.uuid({ error: 'INGREDIENT_REQUIRED' }),
        quantity: positiveQuantitySchema,
        // Left out, it takes the supplier's price (rule 2).
        unitPrice: priceSchema.nullable().optional(),
      }),
    )
    .min(1, 'ORDER_EMPTY')
    .max(MAX_PURCHASE_ORDER_LINES, 'ORDER_TOO_LONG')
    .refine(
      (lines) => new Set(lines.map((line) => line.ingredientId)).size === lines.length,
      'INGREDIENT_DUPLICATE',
    ),
};

export const createPurchaseOrderRequestSchema = z.strictObject({
  branchId: z.uuid({ error: 'BRANCH_REQUIRED' }),
  supplierId: z.uuid({ error: 'SUPPLIER_REQUIRED' }),
  ...orderContent,
});
export type CreatePurchaseOrderRequest = z.infer<typeof createPurchaseOrderRequestSchema>;

export const updatePurchaseOrderRequestSchema = z.strictObject(orderContent);
export type UpdatePurchaseOrderRequest = z.infer<typeof updatePurchaseOrderRequestSchema>;

export const cancelPurchaseOrderRequestSchema = z.strictObject({
  reason: z
    .string({ error: 'NOTE_REQUIRED' })
    .trim()
    .min(1, 'NOTE_REQUIRED')
    .max(200, 'NOTE_TOO_LONG'),
});
export type CancelPurchaseOrderRequest = z.infer<typeof cancelPurchaseOrderRequestSchema>;
