import {
  businessDateOn,
  fromMils,
  localizedTextSchema,
  type Overview,
  type OverviewAttention,
  type OverviewQuery,
  OVERVIEW_TOP_ITEMS,
  parseBranchConfig,
  toMils,
} from '@pos/shared';
import type { Branch as BranchRow, Prisma } from '../../generated/prisma/client';
import { errors } from '../../lib/http-errors';
import type { ActorContext } from '../../middleware/authenticate';
import { dbDate } from '../orders/orders.common';

const mils = (value: Prisma.Decimal | null | undefined): number =>
  value ? toMils(value.toFixed(3)) : 0;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

// The hour of a moment on a branch's clock, 0 to 23.
function hourOn(at: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(at)
    .find((part) => part.type === 'hour')?.value;
  return Number(hour ?? 0) % 24;
}

const dayBefore = (date: string, days: number) =>
  new Date(dbDate(date).getTime() - days * DAY_MS).toISOString().slice(0, 10);

interface BranchDay {
  branch: BranchRow;
  today: string;
  dayEndsAt: string;
}

// Today's overview of the brands and branches a person sees. It stores nothing; every figure
// is read from the orders, payments, refunds, shifts and tables. See
// docs/specs/024-group-dashboard.md.
export function createOverviewService({ now }: { now: () => Date }) {
  return {
    async today({ auth, db }: ActorContext, query: OverviewQuery): Promise<Overview> {
      if (auth.scope === 'BRANCH') {
        throw errors.forbidden();
      }
      if (query.brandId) {
        const brand = await db.brand.findUnique({ where: { id: query.brandId } });
        if (!brand) throw errors.notFound('Brand');
      }
      const at = now();

      // Each active branch of an active brand, with today on its clock (rule 1).
      const branches = await db.branch.findMany({
        where: {
          isActive: true,
          brand: { isActive: true },
          ...(query.brandId ? { brandId: query.brandId } : {}),
        },
        orderBy: [{ brandId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      });
      const brands = await db.brand.findMany({
        where: { id: { in: [...new Set(branches.map((branch) => branch.brandId))] } },
      });
      const brandName = new Map(
        brands.map((brand) => [brand.id, localizedTextSchema.parse(brand.name)]),
      );
      const days: BranchDay[] = branches.map((branch) => {
        const { dayEndsAt } = parseBranchConfig(branch.config);
        return { branch, today: businessDateOn(at, branch.timezone, dayEndsAt), dayEndsAt };
      });
      const branchIds = branches.map((branch) => branch.id);
      const todayOf = new Map(days.map((day) => [day.branch.id, day.today]));
      const ofToday = days.map((day) => ({
        branchId: day.branch.id,
        businessDate: dbDate(day.today),
      }));
      const ofLastWeek = days.map((day) => ({
        branchId: day.branch.id,
        businessDate: dbDate(dayBefore(day.today, 7)),
      }));
      const nothing = { branchId: { in: [] as string[] } };
      const todayWhere = ofToday.length > 0 ? { OR: ofToday } : nothing;
      const paidToday = { ...todayWhere, status: 'paid' as const };

      // Sales and orders of today (rule 2), and of last week up to this moment (rule 3).
      const sold = await db.order.groupBy({
        by: ['branchId'],
        where: paidToday,
        _count: { _all: true },
        _sum: { total: true, promotionDiscount: true, discountAmount: true, pointsDiscount: true },
      });
      const lastWeek = await db.order.groupBy({
        by: ['branchId'],
        where: {
          ...(ofLastWeek.length > 0 ? { OR: ofLastWeek } : nothing),
          status: 'paid',
          paidAt: { lte: new Date(at.getTime() - WEEK_MS) },
        },
        _count: { _all: true },
        _sum: { total: true },
      });
      const voided = await db.order.groupBy({
        by: ['branchId'],
        where: { ...todayWhere, status: 'voided' },
        _count: { _all: true },
        _sum: { total: true },
      });

      // Today's voids by reason: whole orders, and single dishes of orders that went on.
      const voidedByReason = await db.order.groupBy({
        by: ['voidReason'],
        where: { ...todayWhere, status: 'voided' },
        _count: { _all: true },
        _sum: { total: true },
      });
      const voidedLines = await db.orderLine.groupBy({
        by: ['voidReason'],
        where: { branchId: { in: branchIds }, status: 'voided', order: todayWhere },
        _count: { _all: true },
        _sum: { lineTotal: true },
      });
      const byReason = new Map<string, { orders: number; lines: number; amount: number }>();
      const reasonRow = (reason: string | null) => {
        const key = reason ?? '';
        const row = byReason.get(key) ?? { orders: 0, lines: 0, amount: 0 };
        byReason.set(key, row);
        return row;
      };
      for (const row of voidedByReason) {
        const total = reasonRow(row.voidReason);
        total.orders += row._count._all;
        total.amount += mils(row._sum.total);
      }
      for (const row of voidedLines) {
        const total = reasonRow(row.voidReason);
        total.lines += row._count._all;
        total.amount += mils(row._sum.lineTotal);
      }
      const voids = [...byReason.entries()]
        .map(([reason, total]) => ({ reason, ...total }))
        .sort((a, b) => b.amount - a.amount || b.orders + b.lines - (a.orders + a.lines))
        .map((row) => ({ ...row, amount: fromMils(row.amount) }));

      // What is open now (rule 5).
      const open = await db.order.groupBy({
        by: ['branchId'],
        where: { branchId: { in: branchIds }, status: 'open' },
        _count: { _all: true },
        _sum: { total: true },
      });
      const atTables = await db.order.groupBy({
        by: ['branchId'],
        where: { branchId: { in: branchIds }, status: 'open', tableOpenKey: { not: null } },
        _count: { _all: true },
      });
      const tables = await db.diningTable.groupBy({
        by: ['branchId'],
        where: { branchId: { in: branchIds }, isActive: true },
        _count: { _all: true },
      });
      const shifts = await db.shift.findMany({
        where: { branchId: { in: branchIds }, status: 'open' },
        select: { branchId: true, openedAt: true, openedByName: true },
        orderBy: { openedAt: 'asc' },
      });

      // The money given back today, whenever the order was paid (rule 4). A refund is at most a
      // day and a half old to be today's somewhere.
      const refundRows = await db.refund.findMany({
        where: {
          branchId: { in: branchIds },
          createdAt: { gte: new Date(at.getTime() - 2 * DAY_MS) },
        },
        select: { branchId: true, amount: true, createdAt: true },
      });
      const dayOf = new Map(days.map((day) => [day.branch.id, day]));
      const refunds = new Map<string, { count: number; amount: number }>();
      for (const row of refundRows) {
        const day = dayOf.get(row.branchId);
        if (!day) continue;
        if (businessDateOn(row.createdAt, day.branch.timezone, day.dayEndsAt) !== day.today)
          continue;
        const total = refunds.get(row.branchId) ?? { count: 0, amount: 0 };
        refunds.set(row.branchId, {
          count: total.count + 1,
          amount: total.amount + mils(row.amount),
        });
      }

      // Sales by hour of payment on each branch's clock (rule 6).
      const paidRows = await db.order.findMany({
        where: paidToday,
        select: { branchId: true, paidAt: true, total: true },
      });
      const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, sales: 0, orders: 0 }));
      for (const row of paidRows) {
        const day = dayOf.get(row.branchId);
        if (!day || !row.paidAt) continue;
        const slot = hours[hourOn(row.paidAt, day.branch.timezone)];
        if (!slot) continue;
        slot.sales += mils(row.total);
        slot.orders += 1;
      }

      // The dishes sold most today (rule 7).
      const lines = await db.orderLine.groupBy({
        by: ['kind', 'itemId', 'comboId'],
        where: {
          branchId: { in: branchIds },
          status: { not: 'voided' },
          order: paidToday,
        },
        _sum: { quantity: true, lineTotal: true },
      });
      const top = lines
        .map((row) => ({
          kind: row.kind,
          id: row.itemId ?? row.comboId,
          quantity: row._sum.quantity ?? 0,
          sales: mils(row._sum.lineTotal),
        }))
        .filter((row): row is typeof row & { id: string } => row.id !== null)
        .sort((a, b) => b.quantity - a.quantity || b.sales - a.sales)
        .slice(0, OVERVIEW_TOP_ITEMS);
      const items = await db.menuItem.findMany({
        where: { id: { in: top.filter((row) => row.kind === 'item').map((row) => row.id) } },
        select: { id: true, name: true },
      });
      const combos = await db.combo.findMany({
        where: { id: { in: top.filter((row) => row.kind === 'combo').map((row) => row.id) } },
        select: { id: true, name: true },
      });
      const nameOf = new Map(
        [...items, ...combos].map((row) => [row.id, localizedTextSchema.parse(row.name)]),
      );

      const by = <T extends { branchId: string }>(rows: T[]) =>
        new Map(rows.map((row) => [row.branchId, row]));
      const soldOf = by(sold);
      const lastWeekOf = by(lastWeek);
      const openOf = by(open);
      const tablesInUseOf = by(atTables);
      const tablesOf = by(tables);

      // What needs a manager (rule 8): old shifts first, then the most money.
      const attention: OverviewAttention[] = [];
      for (const shift of shifts) {
        const day = dayOf.get(shift.branchId);
        if (!day) continue;
        if (businessDateOn(shift.openedAt, day.branch.timezone, day.dayEndsAt) >= day.today)
          continue;
        attention.push({
          kind: 'old_shift',
          branchId: shift.branchId,
          count: 1,
          amount: '0.000',
          name: shift.openedByName,
          since: shift.openedAt.toISOString(),
        });
      }
      const money: (OverviewAttention & { mils: number })[] = [];
      for (const row of voided) {
        const amount = mils(row._sum.total);
        money.push({
          kind: 'voids',
          branchId: row.branchId,
          count: row._count._all,
          amount: fromMils(amount),
          name: null,
          since: null,
          mils: amount,
        });
      }
      for (const [branchId, total] of refunds) {
        money.push({
          kind: 'refunds',
          branchId,
          count: total.count,
          amount: fromMils(total.amount),
          name: null,
          since: null,
          mils: total.amount,
        });
      }
      money.sort((a, b) => b.mils - a.mils || b.count - a.count);
      attention.push(...money.map(({ mils: _mils, ...row }) => row));

      // The summary of every branch shown.
      let sales = 0;
      let orders = 0;
      let discounts = 0;
      for (const row of sold) {
        sales += mils(row._sum.total);
        orders += row._count._all;
        discounts +=
          mils(row._sum.promotionDiscount) +
          mils(row._sum.discountAmount) +
          mils(row._sum.pointsDiscount);
      }
      const lastWeekSales = lastWeek.reduce((sum, row) => sum + mils(row._sum.total), 0);

      return {
        generatedAt: at.toISOString(),
        summary: {
          sales: fromMils(sales),
          orders,
          averageOrder: fromMils(orders > 0 ? Math.round(sales / orders) : 0),
          discounts: fromMils(discounts),
          refunds: fromMils([...refunds.values()].reduce((sum, row) => sum + row.amount, 0)),
          voidedOrders: voided.reduce((sum, row) => sum + row._count._all, 0),
          lastWeekSales: fromMils(lastWeekSales),
          lastWeekOrders: lastWeek.reduce((sum, row) => sum + row._count._all, 0),
        },
        branches: branches.map((branch) => ({
          id: branch.id,
          brandId: branch.brandId,
          name: localizedTextSchema.parse(branch.name),
          brandName: brandName.get(branch.brandId) ?? { en: '', ar: '' },
          businessDate: todayOf.get(branch.id) ?? '',
          sales: fromMils(mils(soldOf.get(branch.id)?._sum.total)),
          orders: soldOf.get(branch.id)?._count._all ?? 0,
          lastWeekSales: fromMils(mils(lastWeekOf.get(branch.id)?._sum.total)),
          openOrders: openOf.get(branch.id)?._count._all ?? 0,
          openTotal: fromMils(mils(openOf.get(branch.id)?._sum.total)),
          tablesInUse: tablesInUseOf.get(branch.id)?._count._all ?? 0,
          tables: tablesOf.get(branch.id)?._count._all ?? 0,
          openShifts: shifts.filter((shift) => shift.branchId === branch.id).length,
        })),
        hours: hours.map((slot) => ({ ...slot, sales: fromMils(slot.sales) })),
        topItems: top.map((row) => ({
          kind: row.kind,
          id: row.id,
          name: nameOf.get(row.id) ?? { en: '?', ar: '?' },
          quantity: row.quantity,
          sales: fromMils(row.sales),
        })),
        attention,
        voids,
      };
    },
  };
}

export type OverviewService = ReturnType<typeof createOverviewService>;
