import {
  fromMils,
  localizedTextSchema,
  type SalesReport,
  type SalesReportQuery,
  toMils,
} from '@pos/shared';
import type { Prisma } from '../../generated/prisma/client';
import { errors } from '../../lib/http-errors';
import type { ActorContext } from '../../middleware/authenticate';
import { invalid } from '../menu/menu.common';
import { dbDate } from '../orders/orders.common';

const mils = (value: Prisma.Decimal | null | undefined): number =>
  value ? toMils(value.toFixed(3)) : 0;
const day = (value: Date) => value.toISOString().slice(0, 10);

// A dish or a combo as it sold, in mils.
interface SoldRow {
  kind: 'item' | 'combo';
  id: string;
  categoryId: string | null;
  name: { en: string; ar: string };
  quantity: number;
  sales: number;
  foodCost: number | null;
}

// Every business day of the period, the last one included.
function daysOf(from: string, to: string): string[] {
  const days: string[] = [];
  for (let at = dbDate(from); at <= dbDate(to); at = new Date(at.getTime() + 86_400_000)) {
    days.push(day(at));
  }
  return days;
}

// What was sold, how it was paid, and what it cost. It stores nothing; every figure is read from
// the orders, payments and refunds. See docs/specs/020-sales-reports.md.
export function createReportsService() {
  // The branches the report covers: one, or every branch of a brand the person sees (rule 2).
  async function branchesOf({ auth, db }: ActorContext, query: SalesReportQuery) {
    if (query.branchId) {
      const branch = await db.branch.findUnique({ where: { id: query.branchId } });
      if (!branch) throw errors.notFound('Branch');
      return [branch.id];
    }
    if (auth.scope === 'GROUP' && !query.brandId) throw invalid('brandId', 'BRAND_REQUIRED');
    if (query.brandId) {
      const brand = await db.brand.findUnique({ where: { id: query.brandId } });
      if (!brand) throw errors.notFound('Brand');
    }
    const branches = await db.branch.findMany({
      where: query.brandId ? { brandId: query.brandId } : {},
    });
    return branches.map((branch) => branch.id);
  }

  return {
    async sales(ctx: ActorContext, query: SalesReportQuery): Promise<SalesReport> {
      const { db } = ctx;
      const branchIds = await branchesOf(ctx, query);
      const businessDate = { gte: dbDate(query.from), lte: dbDate(query.to) };
      // The paid orders of the period, which every figure is about (rule 3).
      const paidOrder = { businessDate, status: 'paid' as const };
      const inBranches = { branchId: { in: branchIds } };

      const byDay = await db.order.groupBy({
        by: ['businessDate'],
        where: { ...inBranches, ...paidOrder },
        _count: { _all: true },
        _sum: {
          subtotal: true,
          promotionDiscount: true,
          pointsDiscount: true,
          discountAmount: true,
          total: true,
          refunded: true,
        },
      });
      const voidedOrders = await db.order.count({
        where: { ...inBranches, businessDate, status: 'voided' },
      });

      // The summary (rule 3).
      let orders = 0;
      let gross = 0;
      let discounts = 0;
      let net = 0;
      let refunds = 0;
      for (const row of byDay) {
        orders += row._count._all;
        gross += mils(row._sum.subtotal);
        discounts +=
          mils(row._sum.discountAmount) +
          mils(row._sum.promotionDiscount) +
          mils(row._sum.pointsDiscount);
        net += mils(row._sum.total);
        refunds += mils(row._sum.refunded);
      }

      // Each day of the period, the days without sales too (rule 4).
      const dayOf = new Map(byDay.map((row) => [day(row.businessDate), row]));
      const days = daysOf(query.from, query.to).map((date) => {
        const row = dayOf.get(date);
        return {
          date,
          orders: row?._count._all ?? 0,
          netSales: fromMils(mils(row?._sum.total)),
          refunds: fromMils(mils(row?._sum.refunded)),
        };
      });

      // By way of payment, named as at the time of payment, with what went back that way (rule 5).
      const paymentWhere = { ...inBranches, order: paidOrder };
      const paid = await db.payment.groupBy({
        by: ['method'],
        where: paymentWhere,
        _count: { _all: true },
        _sum: { amount: true },
      });
      const refunded = await db.refund.groupBy({
        by: ['method'],
        where: paymentWhere,
        _sum: { amount: true },
      });
      const named = await db.payment.findMany({
        where: paymentWhere,
        distinct: ['method'],
        orderBy: [{ method: 'asc' }, { createdAt: 'desc' }],
        select: { method: true, methodName: true },
      });
      const refundNames = await db.refund.findMany({
        where: paymentWhere,
        distinct: ['method'],
        orderBy: [{ method: 'asc' }, { createdAt: 'desc' }],
        select: { method: true, methodName: true },
      });
      const nameOf = new Map(
        [...refundNames, ...named].map((row) => [
          row.method,
          localizedTextSchema.safeParse(row.methodName).data ?? { en: row.method, ar: row.method },
        ]),
      );
      const refundOf = new Map(refunded.map((row) => [row.method, mils(row._sum.amount)]));
      const paidOf = new Map(paid.map((row) => [row.method, row]));
      const methods = [...new Set([...paidOf.keys(), ...refundOf.keys()])];
      const payments = methods
        .map((method) => ({
          method,
          name: nameOf.get(method) ?? { en: method, ar: method },
          count: paidOf.get(method)?._count._all ?? 0,
          amount: mils(paidOf.get(method)?._sum.amount),
          refunds: refundOf.get(method) ?? 0,
        }))
        .sort((a, b) => b.amount - a.amount || a.method.localeCompare(b.method))
        .map((row) => ({ ...row, amount: fromMils(row.amount), refunds: fromMils(row.refunds) }));

      // By dish and combo: the lines that were not voided, before the order's discount (rule 6).
      const lines = await db.orderLine.groupBy({
        by: ['kind', 'itemId', 'comboId'],
        where: { ...inBranches, status: { not: 'voided' }, order: paidOrder },
        _sum: { quantity: true, lineTotal: true },
      });
      const itemIds = lines.flatMap((row) => (row.itemId ? [row.itemId] : []));
      const comboIds = lines.flatMap((row) => (row.comboId ? [row.comboId] : []));
      const items = await db.menuItem.findMany({ where: { id: { in: itemIds } } });
      const combos = await db.combo.findMany({ where: { id: { in: comboIds } } });
      const itemOf = new Map(items.map((row) => [row.id, row]));
      const comboOf = new Map(combos.map((row) => [row.id, row]));

      // The cost of one of each dish from its recipe, at today's ingredient costs.
      const recipes = await db.recipeLine.findMany({ where: { itemId: { in: itemIds } } });
      const ingredients = await db.ingredient.findMany({
        where: { id: { in: [...new Set(recipes.map((row) => row.ingredientId))] } },
      });
      const costOfIngredient = new Map(ingredients.map((row) => [row.id, mils(row.costPerUnit)]));
      const recipeCost = new Map<string, number>();
      for (const row of recipes) {
        if (!row.itemId) continue;
        const cost = Math.round(
          (mils(row.quantity) * (costOfIngredient.get(row.ingredientId) ?? 0)) / 1000,
        );
        recipeCost.set(row.itemId, (recipeCost.get(row.itemId) ?? 0) + cost);
      }

      const sold = lines
        .flatMap((row): SoldRow[] => {
          const quantity = row._sum.quantity ?? 0;
          const sales = mils(row._sum.lineTotal);
          if (row.kind === 'item' && row.itemId) {
            const item = itemOf.get(row.itemId);
            if (!item) return [];
            const unitCost = recipeCost.get(row.itemId);
            const foodCost = unitCost === undefined ? null : unitCost * quantity;
            return [
              {
                kind: 'item',
                id: row.itemId,
                categoryId: item.categoryId,
                name: localizedTextSchema.parse(item.name),
                quantity,
                sales,
                foodCost,
              },
            ];
          }
          const combo = row.comboId ? comboOf.get(row.comboId) : undefined;
          if (!combo) return [];
          return [
            {
              kind: 'combo',
              id: combo.id,
              categoryId: null,
              name: localizedTextSchema.parse(combo.name),
              quantity,
              sales,
              foodCost: null,
            },
          ];
        })
        .sort((a, b) => b.sales - a.sales || b.quantity - a.quantity);

      // By menu category; the combos are a line of their own (rule 7).
      const categoryIds = [
        ...new Set(sold.flatMap((row) => (row.categoryId ? [row.categoryId] : []))),
      ];
      const categories = await db.menuCategory.findMany({ where: { id: { in: categoryIds } } });
      const categoryName = new Map(
        categories.map((row) => [row.id, localizedTextSchema.parse(row.name)]),
      );
      const byCategory = new Map<string | null, { quantity: number; sales: number }>();
      for (const row of sold) {
        const total = byCategory.get(row.categoryId) ?? { quantity: 0, sales: 0 };
        byCategory.set(row.categoryId, {
          quantity: total.quantity + row.quantity,
          sales: total.sales + row.sales,
        });
      }

      return {
        from: query.from,
        to: query.to,
        summary: {
          orders,
          grossSales: fromMils(gross),
          discounts: fromMils(discounts),
          netSales: fromMils(net),
          refunds: fromMils(refunds),
          netAfterRefunds: fromMils(net - refunds),
          averageOrder: fromMils(orders > 0 ? Math.round(net / orders) : 0),
          voidedOrders,
        },
        days,
        payments,
        items: sold.map((row) => ({
          kind: row.kind,
          id: row.id,
          name: row.name,
          quantity: row.quantity,
          sales: fromMils(row.sales),
          foodCost: row.foodCost === null ? null : fromMils(row.foodCost),
          foodCostPercent:
            row.foodCost === null || row.sales === 0
              ? null
              : Math.round((row.foodCost * 1000) / row.sales) / 10,
        })),
        categories: [...byCategory.entries()]
          .map(([id, total]) => ({
            id,
            name: id ? (categoryName.get(id) ?? null) : null,
            quantity: total.quantity,
            sales: fromMils(total.sales),
          }))
          .sort((a, b) => toMils(b.sales) - toMils(a.sales)),
      };
    },
  };
}

export type ReportsService = ReturnType<typeof createReportsService>;
