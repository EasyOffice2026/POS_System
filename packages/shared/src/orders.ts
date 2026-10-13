import { z } from 'zod';
import { localizedTextSchema } from './localized';
import { formatMoney, priceSchema, toMils } from './money';
import { cursorQuerySchema } from './pagination';

// Orders at a branch: dishes and combos copied from the branch menu with their prices, sent to the
// kitchen, discounted or voided with a manager's approval. See docs/specs/005-orders.md. A problem
// in a request is a code, such as MODIFIER_CHOICE_MISSING, that the screens turn into a sentence.

export const MAX_ORDER_LINES = 200;
export const MAX_LINE_QUANTITY = 99;

export const orderTypes = ['dine_in', 'takeaway'] as const;
export const orderTypeSchema = z.enum(orderTypes, { error: 'ORDER_TYPE_INVALID' });
export type OrderType = z.infer<typeof orderTypeSchema>;

// A paid order is closed: nothing about it changes any more (spec 007).
export const orderStatuses = ['open', 'paid', 'voided'] as const;
export const orderStatusSchema = z.enum(orderStatuses);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

// Where a ticket of the kitchen is (docs/specs/008-kitchen-display.md). A sent line shows the
// status of its ticket.
export const ticketStatuses = ['new', 'preparing', 'ready', 'done'] as const;
export const ticketStatusSchema = z.enum(ticketStatuses, { error: 'TICKET_STATUS_INVALID' });
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

export const orderLineStatuses = ['pending', 'sent', 'voided'] as const;
export const orderLineStatusSchema = z.enum(orderLineStatuses);
export type OrderLineStatus = z.infer<typeof orderLineStatusSchema>;

export const discountKinds = ['percent', 'amount'] as const;
export const discountKindSchema = z.enum(discountKinds, { error: 'DISCOUNT_KIND_INVALID' });
export type DiscountKind = z.infer<typeof discountKindSchema>;

// A card payment is recorded by hand until a card provider is chosen. See docs/specs/007-payments.md.
export const paymentMethods = ['cash', 'card'] as const;
export const paymentMethodSchema = z.enum(paymentMethods, { error: 'PAYMENT_METHOD_INVALID' });
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const MAX_TENDERS = 10;

// ---------------------------------------------------------------------------------------------
// What the API answers

// A modifier as it was chosen, with its price at that moment.
export const orderModifierSchema = z.object({
  id: z.uuid(),
  groupId: z.uuid(),
  name: localizedTextSchema,
  priceDelta: z.string(),
});
export type OrderModifier = z.infer<typeof orderModifierSchema>;

// One choice in a combo: the dish that fills a slot, its extra charge and its modifiers.
export const orderComboChoiceSchema = z.object({
  slotId: z.uuid(),
  slotName: localizedTextSchema,
  itemId: z.uuid(),
  name: localizedTextSchema,
  priceDelta: z.string(),
  modifiers: z.array(orderModifierSchema),
});
export type OrderComboChoice = z.infer<typeof orderComboChoiceSchema>;

export const orderLineKinds = ['item', 'combo'] as const;

export const orderLineSchema = z.object({
  id: z.uuid(),
  kind: z.enum(orderLineKinds),
  itemId: z.uuid().nullable(),
  comboId: z.uuid().nullable(),
  name: localizedTextSchema,
  // The price of one, with its modifiers and combo choices.
  unitPrice: z.string(),
  quantity: z.number().int(),
  lineTotal: z.string(),
  modifiers: z.array(orderModifierSchema),
  choices: z.array(orderComboChoiceSchema),
  note: z.string().nullable(),
  status: orderLineStatusSchema,
  // The status of the kitchen ticket it was sent on, or null before it is sent.
  kitchenStatus: ticketStatusSchema.nullable(),
  sentAt: z.iso.datetime().nullable(),
  voidedAt: z.iso.datetime().nullable(),
  voidReason: z.string().nullable(),
});
export type OrderLine = z.infer<typeof orderLineSchema>;

export const orderDiscountSchema = z.object({
  kind: discountKindSchema,
  // The percentage ("10.00") or the amount ("5.000") that was given.
  value: z.string(),
  // What it takes off the subtotal now.
  amount: z.string(),
  reason: z.string(),
});
export type OrderDiscount = z.infer<typeof orderDiscountSchema>;

// One way the order was paid.
export const orderPaymentSchema = z.object({
  id: z.uuid(),
  method: paymentMethodSchema,
  // The part of the order it pays.
  amount: z.string(),
  // Cash only: what the customer handed over, and what they got back.
  tendered: z.string().nullable(),
  change: z.string(),
  // Card only: the slip number, if the cashier typed it.
  reference: z.string().nullable(),
  takenById: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type OrderPayment = z.infer<typeof orderPaymentSchema>;

const orderFields = {
  id: z.uuid(),
  brandId: z.uuid(),
  branchId: z.uuid(),
  // The day on the branch's clock when the order was opened (YYYY-MM-DD).
  businessDate: z.iso.date(),
  // Counts from 1 every business day at each branch.
  number: z.number().int(),
  type: orderTypeSchema,
  status: orderStatusSchema,
  note: z.string().nullable(),
  currency: z.literal('SAR'),
  subtotal: z.string(),
  discount: orderDiscountSchema.nullable(),
  total: z.string(),
  openedById: z.uuid(),
  voidedAt: z.iso.datetime().nullable(),
  voidReason: z.string().nullable(),
  paidAt: z.iso.datetime().nullable(),
  paidById: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

export const orderSchema = z.object({
  ...orderFields,
  lines: z.array(orderLineSchema),
  payments: z.array(orderPaymentSchema),
  // The change given back in all ("0.000" when none, or before payment).
  change: z.string(),
});
export type Order = z.infer<typeof orderSchema>;

// An order in a list: everything but the lines.
export const orderSummarySchema = z.object({ ...orderFields, lineCount: z.number().int() });
export type OrderSummary = z.infer<typeof orderSummarySchema>;

// ---------------------------------------------------------------------------------------------
// Requests

const noteField = z
  .string({ error: 'NOTE_INVALID' })
  .trim()
  .max(200, 'NOTE_TOO_LONG')
  .transform((text) => (text === '' ? null : text));

const reasonField = z
  .string({ error: 'REASON_REQUIRED' })
  .trim()
  .min(1, 'REASON_REQUIRED')
  .max(200, 'REASON_TOO_LONG');

const quantityField = z
  .number({ error: 'QUANTITY_INVALID' })
  .int('QUANTITY_INVALID')
  .min(1, 'QUANTITY_INVALID')
  .max(MAX_LINE_QUANTITY, 'QUANTITY_INVALID');

const modifierIdsField = z
  .array(z.uuid({ error: 'MODIFIER_NOT_AVAILABLE' }))
  .max(100)
  .default([])
  .refine((ids) => new Set(ids).size === ids.length, 'MODIFIER_DUPLICATE');

// A manager's staff code and PIN, typed on the cashier's terminal to allow a void or a discount.
export const approvalSchema = z.strictObject({
  staffCode: z.string({ error: 'APPROVAL_INVALID' }).trim().min(1, 'APPROVAL_INVALID').max(32),
  pin: z.string({ error: 'APPROVAL_INVALID' }).min(1, 'APPROVAL_INVALID').max(32),
});
export type Approval = z.infer<typeof approvalSchema>;

export const orderListQuerySchema = cursorQuerySchema.extend({
  branchId: z.uuid().optional(),
  status: orderStatusSchema.optional(),
  businessDate: z.iso.date().optional(),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export const createOrderRequestSchema = z.strictObject({
  // Made on the terminal, so sending the same order twice makes no copy (offline mode).
  id: z.uuid().optional(),
  branchId: z.uuid({ error: 'BRANCH_REQUIRED' }),
  type: orderTypeSchema,
  note: noteField.optional(),
});
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

export const updateOrderRequestSchema = z
  .strictObject({
    type: orderTypeSchema.optional(),
    note: noteField.nullable().optional(),
  })
  .refine((request) => Object.keys(request).length > 0, { message: 'NOTHING_TO_UPDATE' });
export type UpdateOrderRequest = z.infer<typeof updateOrderRequestSchema>;

const comboChoiceRequestSchema = z.strictObject({
  slotId: z.uuid({ error: 'SLOT_NOT_FOUND' }),
  itemId: z.uuid({ error: 'OPTION_NOT_AVAILABLE' }),
  modifierIds: modifierIdsField,
});

export const addOrderLineRequestSchema = z.discriminatedUnion(
  'kind',
  [
    z.strictObject({
      id: z.uuid().optional(),
      kind: z.literal('item'),
      itemId: z.uuid({ error: 'ITEM_NOT_AVAILABLE' }),
      quantity: quantityField.default(1),
      modifierIds: modifierIdsField,
      note: noteField.optional(),
    }),
    z.strictObject({
      id: z.uuid().optional(),
      kind: z.literal('combo'),
      comboId: z.uuid({ error: 'COMBO_NOT_AVAILABLE' }),
      quantity: quantityField.default(1),
      choices: z
        .array(comboChoiceRequestSchema)
        .max(10)
        .refine(
          (choices) => new Set(choices.map((choice) => choice.slotId)).size === choices.length,
          'SLOT_CHOSEN_TWICE',
        ),
      note: noteField.optional(),
    }),
  ],
  { error: 'LINE_KIND_INVALID' },
);
export type AddOrderLineRequest = z.infer<typeof addOrderLineRequestSchema>;

export const updateOrderLineRequestSchema = z
  .strictObject({
    quantity: quantityField.optional(),
    note: noteField.nullable().optional(),
  })
  .refine((request) => Object.keys(request).length > 0, { message: 'NOTHING_TO_UPDATE' });
export type UpdateOrderLineRequest = z.infer<typeof updateOrderLineRequestSchema>;

export const voidRequestSchema = z.strictObject({
  reason: reasonField,
  approval: approvalSchema.optional(),
});
export type VoidRequest = z.infer<typeof voidRequestSchema>;

const percentText = /^\d{1,3}(\.\d{1,2})?$/;

// A percentage above 0 and up to 100 with up to 2 decimals, or an amount of money above 0.
export const setDiscountRequestSchema = z
  .strictObject({
    kind: discountKindSchema,
    value: z.string({ error: 'DISCOUNT_VALUE_INVALID' }).trim(),
    reason: reasonField,
    approval: approvalSchema.optional(),
  })
  .superRefine((request, ctx) => {
    const valid =
      request.kind === 'percent'
        ? percentText.test(request.value) &&
          Number(request.value) > 0 &&
          Number(request.value) <= 100
        : priceSchema.safeParse(request.value).success && Number(request.value) > 0;
    if (!valid) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'DISCOUNT_VALUE_INVALID' });
    }
  })
  .transform((request) => ({
    ...request,
    // Written the same way every time: "10.00" or "5.000".
    value:
      request.kind === 'percent'
        ? Number(request.value).toFixed(2)
        : priceSchema.parse(request.value),
  }));
export type SetDiscountRequest = z.infer<typeof setDiscountRequestSchema>;

// Removing a discount needs the same right as giving one.
export const removeDiscountRequestSchema = z.strictObject({
  approval: approvalSchema.optional(),
});
export type RemoveDiscountRequest = z.infer<typeof removeDiscountRequestSchema>;

// An amount paid or handed over. It can be more than a menu price: a whole order, or the notes a
// customer hands over for it.
const amountField = z
  .string({ error: 'PAYMENT_AMOUNT_INVALID' })
  .trim()
  .regex(/^\d{1,12}(\.\d{1,3})?$/, 'PAYMENT_AMOUNT_INVALID')
  .transform(formatMoney)
  .refine((amount) => Number(amount) > 0, 'PAYMENT_AMOUNT_INVALID');

const tenderSchema = z.discriminatedUnion(
  'method',
  [
    z.strictObject({
      id: z.uuid(),
      method: z.literal('cash'),
      amount: amountField,
      tendered: amountField,
    }),
    z.strictObject({
      id: z.uuid(),
      method: z.literal('card'),
      amount: amountField,
      reference: z
        .string()
        .trim()
        .max(40, 'PAYMENT_REFERENCE_TOO_LONG')
        .transform((text) => (text === '' ? null : text))
        .optional(),
    }),
  ],
  { error: 'PAYMENT_METHOD_INVALID' },
);
export type Tender = z.infer<typeof tenderSchema>;

// The whole payment of an order at once: the parts must add up to its total, which the API checks
// against the order as it is. See docs/specs/007-payments.md, rules 1 to 3.
export const payOrderRequestSchema = z.strictObject({
  tenders: z
    .array(tenderSchema)
    .max(MAX_TENDERS, 'PAYMENT_TENDERS_INVALID')
    .superRefine((tenders, ctx) => {
      if (new Set(tenders.map((tender) => tender.id)).size !== tenders.length) {
        ctx.addIssue({ code: 'custom', message: 'PAYMENT_ID_DUPLICATE' });
      }
      if (tenders.filter((tender) => tender.method === 'cash').length > 1) {
        ctx.addIssue({ code: 'custom', message: 'PAYMENT_TOO_MANY_CASH' });
      }
      tenders.forEach((tender, index) => {
        if (tender.method === 'cash' && toMils(tender.tendered) < toMils(tender.amount)) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'tendered'],
            message: 'PAYMENT_TENDERED_SHORT',
          });
        }
      });
    }),
});
export type PayOrderRequest = z.infer<typeof payOrderRequestSchema>;
