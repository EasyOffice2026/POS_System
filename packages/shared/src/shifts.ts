import { z } from 'zod';
import { localizedTextSchema } from './localized';
import { formatMoney } from './money';
import { cursorQuerySchema } from './pagination';

// A cashier's shift: the cash in the drawer when it opens, every payment taken while it is open,
// and the count at closing. See docs/specs/010-shifts.md.

export const shiftStatuses = ['open', 'closed'] as const;
export const shiftStatusSchema = z.enum(shiftStatuses, { error: 'SHIFT_STATUS_INVALID' });
export type ShiftStatus = z.infer<typeof shiftStatusSchema>;

// An amount of cash: 0 or more, with up to 3 decimals, written as "57.500".
const cashField = z
  .string({ error: 'CASH_INVALID' })
  .trim()
  .regex(/^\d{1,12}(\.\d{1,3})?$/, 'CASH_INVALID')
  .transform(formatMoney);

const noteField = z
  .string({ error: 'NOTE_INVALID' })
  .trim()
  .max(200, 'NOTE_TOO_LONG')
  .transform((text) => (text === '' ? null : text));

// ---------------------------------------------------------------------------------------------
// What the API answers

export const shiftSchema = z.object({
  id: z.uuid(),
  brandId: z.uuid(),
  branchId: z.uuid(),
  status: shiftStatusSchema,
  openedById: z.uuid(),
  openedByName: z.string(),
  openedAt: z.iso.datetime(),
  openingCash: z.string(),
  closedById: z.uuid().nullable(),
  closedByName: z.string().nullable(),
  closedAt: z.iso.datetime().nullable(),
  // Filled in at closing (rules 4 and 5).
  countedCash: z.string().nullable(),
  expectedCash: z.string().nullable(),
  // Counted minus expected: below zero when cash is missing.
  difference: z.string().nullable(),
  note: z.string().nullable(),
});
export type Shift = z.infer<typeof shiftSchema>;

// The sales of a shift, worked out from its payments (rule 8).
export const shiftFiguresSchema = z.object({
  ordersPaid: z.number().int(),
  // The totals of the orders paid in the shift, and the discounts given on them.
  sales: z.string(),
  discounts: z.string(),
  byMethod: z.array(
    z.object({ method: z.string(), methodName: localizedTextSchema, amount: z.string() }),
  ),
  // The opening cash plus the cash taken, as the drawer should hold now.
  cashExpected: z.string(),
});
export type ShiftFigures = z.infer<typeof shiftFiguresSchema>;

export const shiftVoidsSchema = z.object({
  orders: z.number().int(),
  ordersValue: z.string(),
  lines: z.number().int(),
  linesValue: z.string(),
});
export type ShiftVoids = z.infer<typeof shiftVoidsSchema>;

// A shift in a list: with its figures, so a manager sees the differences at a glance (rule 9).
export const shiftSummarySchema = shiftSchema.extend({ figures: shiftFiguresSchema });
export type ShiftSummary = z.infer<typeof shiftSummarySchema>;

// The end-of-shift report.
export const shiftReportSchema = shiftSummarySchema.extend({ voids: shiftVoidsSchema });
export type ShiftReport = z.infer<typeof shiftReportSchema>;

// ---------------------------------------------------------------------------------------------
// Requests

export const openShiftRequestSchema = z.strictObject({
  branchId: z.uuid({ error: 'BRANCH_REQUIRED' }),
  openingCash: cashField,
});
export type OpenShiftRequest = z.infer<typeof openShiftRequestSchema>;

export const closeShiftRequestSchema = z.strictObject({
  countedCash: cashField,
  note: noteField.optional(),
});
export type CloseShiftRequest = z.infer<typeof closeShiftRequestSchema>;

export const currentShiftQuerySchema = z.object({
  branchId: z.uuid({ error: 'BRANCH_REQUIRED' }),
});

export const shiftListQuerySchema = cursorQuerySchema.extend({
  branchId: z.uuid({ error: 'BRANCH_REQUIRED' }),
  status: shiftStatusSchema.optional(),
});
export type ShiftListQuery = z.infer<typeof shiftListQuerySchema>;
