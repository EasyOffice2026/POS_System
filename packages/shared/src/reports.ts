import { z } from 'zod';
import { localizedTextSchema } from './localized';

// What was sold, how it was paid, and what it cost. See docs/specs/020-sales-reports.md.

export const MAX_REPORT_DAYS = 92;

const dayCount = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export const salesReportQuerySchema = z
  .object({
    from: z.iso.date({ error: 'DATE_INVALID' }),
    to: z.iso.date({ error: 'DATE_INVALID' }),
    brandId: z.uuid().optional(),
    branchId: z.uuid().optional(),
  })
  .superRefine((query, ctx) => {
    const days = dayCount(query.from, query.to);
    if (days < 1) ctx.addIssue({ code: 'custom', path: ['to'], message: 'RANGE_INVALID' });
    else if (days > MAX_REPORT_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'RANGE_TOO_LONG' });
    }
  });
export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;

export const salesSummarySchema = z.object({
  orders: z.number().int(),
  grossSales: z.string(),
  discounts: z.string(),
  netSales: z.string(),
  refunds: z.string(),
  netAfterRefunds: z.string(),
  averageOrder: z.string(),
  voidedOrders: z.number().int(),
});
export type SalesSummary = z.infer<typeof salesSummarySchema>;

export const salesReportSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  summary: salesSummarySchema,
  days: z.array(
    z.object({
      date: z.iso.date(),
      orders: z.number().int(),
      netSales: z.string(),
      refunds: z.string(),
    }),
  ),
  payments: z.array(
    z.object({
      method: z.string(),
      name: localizedTextSchema,
      count: z.number().int(),
      amount: z.string(),
      refunds: z.string(),
    }),
  ),
  items: z.array(
    z.object({
      kind: z.enum(['item', 'combo']),
      id: z.uuid(),
      name: localizedTextSchema,
      quantity: z.number().int(),
      sales: z.string(),
      // Null for a combo, or a dish without a recipe.
      foodCost: z.string().nullable(),
      foodCostPercent: z.number().nullable(),
    }),
  ),
  categories: z.array(
    z.object({
      // Null for the combos.
      id: z.uuid().nullable(),
      name: localizedTextSchema.nullable(),
      quantity: z.number().int(),
      sales: z.string(),
    }),
  ),
});
export type SalesReport = z.infer<typeof salesReportSchema>;
