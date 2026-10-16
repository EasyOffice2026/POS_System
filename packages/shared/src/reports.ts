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

// ---------------------------------------------------------------------------------------------
// Today's overview of the group, for the dashboard. See docs/specs/024-group-dashboard.md.

export const overviewQuerySchema = z.object({
  // A group admin may look at one brand; left out, every brand they see.
  brandId: z.uuid().optional(),
});
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;

export const OVERVIEW_TOP_ITEMS = 10;

export const overviewBranchSchema = z.object({
  id: z.uuid(),
  brandId: z.uuid(),
  name: localizedTextSchema,
  brandName: localizedTextSchema,
  businessDate: z.iso.date(),
  sales: z.string(),
  orders: z.number().int(),
  lastWeekSales: z.string(),
  openOrders: z.number().int(),
  openTotal: z.string(),
  tablesInUse: z.number().int(),
  tables: z.number().int(),
  openShifts: z.number().int(),
});
export type OverviewBranch = z.infer<typeof overviewBranchSchema>;

export const overviewAttentionKinds = ['old_shift', 'voids', 'refunds'] as const;

export const overviewAttentionSchema = z.object({
  kind: z.enum(overviewAttentionKinds),
  branchId: z.uuid(),
  count: z.number().int(),
  amount: z.string(),
  // The shift's cashier and when it was opened, for an old shift.
  name: z.string().nullable(),
  since: z.iso.datetime().nullable(),
});
export type OverviewAttention = z.infer<typeof overviewAttentionSchema>;

export const overviewSchema = z.object({
  generatedAt: z.iso.datetime(),
  summary: z.object({
    sales: z.string(),
    orders: z.number().int(),
    averageOrder: z.string(),
    discounts: z.string(),
    refunds: z.string(),
    voidedOrders: z.number().int(),
    lastWeekSales: z.string(),
    lastWeekOrders: z.number().int(),
  }),
  branches: z.array(overviewBranchSchema),
  // Hours 0 to 23 on each branch's clock.
  hours: z.array(z.object({ hour: z.number().int(), sales: z.string(), orders: z.number().int() })),
  topItems: z.array(
    z.object({
      kind: z.enum(['item', 'combo']),
      id: z.uuid(),
      name: localizedTextSchema,
      quantity: z.number().int(),
      sales: z.string(),
    }),
  ),
  attention: z.array(overviewAttentionSchema),
  // Today's voids by reason, orders and single dishes alike, the biggest amounts first.
  voids: z.array(
    z.object({
      reason: z.string(),
      orders: z.number().int(),
      lines: z.number().int(),
      amount: z.string(),
    }),
  ),
});
export type Overview = z.infer<typeof overviewSchema>;
