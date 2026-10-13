import { z } from 'zod';
import { formatMoney } from './money';
import { approvalSchema, paymentMethodSchema } from './orders';

// Money given back for a paid order, with a manager's approval. See docs/specs/011-refunds.md.
// What a refund looks like in an order is in orders.ts (orderRefundSchema).

// An amount above 0 with up to 3 decimals, written as "7.500".
const refundAmountField = z
  .string({ error: 'REFUND_AMOUNT_INVALID' })
  .trim()
  .regex(/^\d{1,12}(\.\d{1,3})?$/, 'REFUND_AMOUNT_INVALID')
  .transform(formatMoney)
  .refine((amount) => Number(amount) > 0, 'REFUND_AMOUNT_INVALID');

const reasonField = z
  .string({ error: 'REASON_REQUIRED' })
  .trim()
  .min(1, 'REASON_REQUIRED')
  .max(200, 'REASON_TOO_LONG');

export const refundRequestSchema = z.strictObject({
  // Made on the terminal, so a refund sent twice is given once (rule 7).
  id: z.uuid(),
  amount: refundAmountField,
  method: paymentMethodSchema,
  reason: reasonField,
  approval: approvalSchema.optional(),
});
export type RefundRequest = z.infer<typeof refundRequestSchema>;
