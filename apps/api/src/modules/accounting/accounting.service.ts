import { businessDateOn, parseBranchConfig, parseBrandSettings } from '@pos/shared';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import { errors } from '../../lib/http-errors';
import type { PrismaClient } from '../../lib/prisma';

// What the ERP reads to post the journals of the restaurants (docs/specs/029-erp-link.md).
// The ERP is not a person: it signs in with an integration key and sees every brand, read only.

export interface AccountingDeps {
  prisma: PrismaClient;
  now: () => Date;
}

export interface DateRange {
  from: string;
  to: string;
}

type Money = Prisma.Decimal;
const zero = () => new Prisma.Decimal(0);
const text = (value: Money) => value.toFixed(3);
const dbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const day = (date: Date) => date.toISOString().slice(0, 10);
const nameOf = (value: unknown): { en: string; ar: string } => {
  const record = (value ?? {}) as Record<string, unknown>;
  const en = typeof record.en === 'string' ? record.en : '';
  const ar = typeof record.ar === 'string' ? record.ar : en;
  return { en, ar };
};

export const KEY_PREFIX = 'posk_';
// Days a range may cover, so one call stays small.
export const MAX_RANGE_DAYS = 31;

export function hashIntegrationKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function checkRange({ from, to }: DateRange): void {
  const days = (dbDate(to).getTime() - dbDate(from).getTime()) / 86_400_000;
  if (Number.isNaN(days) || days < 0)
    throw errors.validation([{ path: 'to', message: 'RANGE_INVALID' }]);
  if (days >= MAX_RANGE_DAYS) throw errors.validation([{ path: 'to', message: 'RANGE_TOO_LONG' }]);
}

interface MethodLine {
  method: string;
  name: { en: string; ar: string };
  amount: Money;
  commission: Money;
}

export interface BranchDay {
  brandId: string;
  branchId: string;
  businessDate: string;
  orders: number;
  gross: Money;
  discounts: Money;
  net: Money;
  payments: Map<string, MethodLine>;
  refunds: Map<string, MethodLine>;
  cashDifference: Money;
  costOfSales: Money;
  waste: Money;
  countDifference: Money;
}

export function createAccountingService({ prisma, now }: AccountingDeps) {
  async function branches() {
    const rows = await prisma.branch.findMany({
      select: { id: true, brandId: true, timezone: true, config: true },
    });
    return new Map(
      rows.map((row) => [row.id, { ...row, dayEndsAt: parseBranchConfig(row.config).dayEndsAt }]),
    );
  }
  type BranchInfo = Awaited<ReturnType<typeof branches>> extends Map<string, infer V> ? V : never;
  const businessDateOf = (branch: BranchInfo, at: Date) =>
    businessDateOn(at, branch.timezone, branch.dayEndsAt);
  // A business day can end the next morning, so the clock times looked at run a day either side.
  const widened = ({ from, to }: DateRange) => ({
    gte: new Date(dbDate(from).getTime() - 86_400_000),
    lt: new Date(dbDate(to).getTime() + 2 * 86_400_000),
  });
  const inRange = (date: string, { from, to }: DateRange) => date >= from && date <= to;

  return {
    async authenticate(key: string): Promise<{ id: string; name: string } | null> {
      if (!key.startsWith(KEY_PREFIX)) return null;
      const row = await prisma.integrationKey.findUnique({
        where: { keyHash: hashIntegrationKey(key) },
      });
      if (!row || row.revokedAt) return null;
      await prisma.integrationKey.update({
        where: { id: row.id },
        data: { lastUsedAt: now() },
      });
      return { id: row.id, name: row.name };
    },

    async listKeys() {
      const rows = await prisma.integrationKey.findMany({ orderBy: { createdAt: 'desc' } });
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        revokedAt: row.revokedAt?.toISOString() ?? null,
      }));
    },

    // The key is shown once; only its hash is kept.
    async createKey(name: string, userId: string) {
      const key = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
      const row = await prisma.integrationKey.create({
        data: { name, keyHash: hashIntegrationKey(key), createdById: userId },
      });
      return { id: row.id, name: row.name, key };
    },

    async revokeKey(id: string) {
      const row = await prisma.integrationKey.findUnique({ where: { id } });
      if (!row) throw errors.notFound('Integration key');
      if (!row.revokedAt) {
        await prisma.integrationKey.update({ where: { id }, data: { revokedAt: now() } });
      }
    },

    // The brands and branches, and the ways of payment of each brand, for the ERP to map.
    async structure() {
      const brands = await prisma.brand.findMany({
        include: { branches: { orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      });
      return {
        brands: brands.map((brand) => ({
          id: brand.id,
          name: nameOf(brand.name),
          isActive: brand.isActive,
          paymentMethods: [
            { key: 'cash', name: { en: 'Cash', ar: 'نقدي' } },
            ...parseBrandSettings(brand.settings).paymentMethods.map((method) => ({
              key: method.key,
              name: nameOf(method.name),
            })),
          ],
          branches: brand.branches.map((branch) => ({
            id: branch.id,
            name: nameOf(branch.name),
            timezone: branch.timezone,
            isActive: branch.isActive,
          })),
        })),
      };
    },

    // Each branch's business days in the range: sales by way of payment with the platform
    // commission, refunds, cash over or short at shift close, and the cost of what was sold,
    // thrown away or found missing at a count (at the ingredient's cost).
    async days(range: DateRange) {
      checkRange(range);
      const branchOf = await branches();
      const result = new Map<string, BranchDay>();
      const dayFor = (branchId: string, businessDate: string): BranchDay | null => {
        const branch = branchOf.get(branchId);
        if (!branch) return null;
        const key = `${branchId}|${businessDate}`;
        let entry = result.get(key);
        if (!entry) {
          entry = {
            brandId: branch.brandId,
            branchId,
            businessDate,
            orders: 0,
            gross: zero(),
            discounts: zero(),
            net: zero(),
            payments: new Map(),
            refunds: new Map(),
            cashDifference: zero(),
            costOfSales: zero(),
            waste: zero(),
            countDifference: zero(),
          };
          result.set(key, entry);
        }
        return entry;
      };
      const addMethod = (
        lines: Map<string, MethodLine>,
        method: string,
        name: unknown,
        amount: Money,
        commission: Money,
      ) => {
        const line = lines.get(method) ?? {
          method,
          name: nameOf(name),
          amount: zero(),
          commission: zero(),
        };
        line.amount = line.amount.plus(amount);
        line.commission = line.commission.plus(commission);
        lines.set(method, line);
      };

      const businessDate = { gte: dbDate(range.from), lte: dbDate(range.to) };
      const orders = await prisma.order.groupBy({
        by: ['branchId', 'businessDate'],
        where: { businessDate, status: 'paid' },
        _count: { _all: true },
        _sum: {
          subtotal: true,
          discountAmount: true,
          promotionDiscount: true,
          pointsDiscount: true,
          total: true,
        },
      });
      for (const row of orders) {
        const entry = dayFor(row.branchId, day(row.businessDate));
        if (!entry) continue;
        entry.orders += row._count._all;
        entry.gross = entry.gross.plus(row._sum.subtotal ?? 0);
        entry.discounts = entry.discounts
          .plus(row._sum.discountAmount ?? 0)
          .plus(row._sum.promotionDiscount ?? 0)
          .plus(row._sum.pointsDiscount ?? 0);
        entry.net = entry.net.plus(row._sum.total ?? 0);
      }

      const payments = await prisma.payment.findMany({
        where: { order: { businessDate, status: 'paid' } },
        select: {
          branchId: true,
          method: true,
          methodName: true,
          amount: true,
          commission: true,
          order: { select: { businessDate: true } },
        },
      });
      for (const row of payments) {
        const entry = dayFor(row.branchId, day(row.order.businessDate));
        if (entry)
          addMethod(entry.payments, row.method, row.methodName, row.amount, row.commission);
      }

      const refunds = await prisma.refund.findMany({
        where: { createdAt: widened(range) },
        select: {
          branchId: true,
          method: true,
          methodName: true,
          amount: true,
          commission: true,
          createdAt: true,
        },
      });
      for (const row of refunds) {
        const branch = branchOf.get(row.branchId);
        if (!branch) continue;
        const date = businessDateOf(branch, row.createdAt);
        if (!inRange(date, range)) continue;
        const entry = dayFor(row.branchId, date);
        if (entry) addMethod(entry.refunds, row.method, row.methodName, row.amount, row.commission);
      }

      const shifts = await prisma.shift.findMany({
        where: { closedAt: widened(range), difference: { not: null } },
        select: { branchId: true, closedAt: true, difference: true },
      });
      for (const row of shifts) {
        const branch = branchOf.get(row.branchId);
        if (!branch || !row.closedAt || !row.difference) continue;
        const date = businessDateOf(branch, row.closedAt);
        if (!inRange(date, range)) continue;
        const entry = dayFor(row.branchId, date);
        if (entry) entry.cashDifference = entry.cashDifference.plus(row.difference);
      }

      const movements = await prisma.stockMovement.findMany({
        where: { createdAt: widened(range), kind: { in: ['sold', 'waste', 'count'] } },
        select: {
          branchId: true,
          kind: true,
          quantity: true,
          createdAt: true,
          ingredient: { select: { costPerUnit: true } },
        },
      });
      for (const row of movements) {
        const branch = branchOf.get(row.branchId);
        if (!branch) continue;
        const date = businessDateOf(branch, row.createdAt);
        if (!inRange(date, range)) continue;
        const entry = dayFor(row.branchId, date);
        if (!entry) continue;
        // Stock going out is a negative quantity; its cost is counted as a positive amount.
        const cost = row.quantity.negated().times(row.ingredient.costPerUnit).toDecimalPlaces(3);
        if (row.kind === 'sold') entry.costOfSales = entry.costOfSales.plus(cost);
        else if (row.kind === 'waste') entry.waste = entry.waste.plus(cost);
        else entry.countDifference = entry.countDifference.plus(cost);
      }

      const days = [...result.values()].sort(
        (a, b) =>
          a.businessDate.localeCompare(b.businessDate) || a.branchId.localeCompare(b.branchId),
      );
      return {
        from: range.from,
        to: range.to,
        days: days.map((entry) => ({
          id: `day:${entry.branchId}:${entry.businessDate}`,
          brandId: entry.brandId,
          branchId: entry.branchId,
          businessDate: entry.businessDate,
          orders: entry.orders,
          gross: text(entry.gross),
          discounts: text(entry.discounts),
          net: text(entry.net),
          payments: [...entry.payments.values()].map((line) => ({
            method: line.method,
            name: line.name,
            amount: text(line.amount),
            commission: text(line.commission),
          })),
          refunds: [...entry.refunds.values()].map((line) => ({
            method: line.method,
            name: line.name,
            amount: text(line.amount),
            commission: text(line.commission),
          })),
          cashDifference: text(entry.cashDifference),
          costOfSales: text(entry.costOfSales),
          waste: text(entry.waste),
          countDifference: text(entry.countDifference),
        })),
      };
    },

    // The purchase orders received in the range, at what was received: each one is a supplier's
    // bill for the ERP.
    async goodsReceipts(range: DateRange) {
      checkRange(range);
      const branchOf = await branches();
      const rows = await prisma.purchaseOrder.findMany({
        where: { status: 'received', receivedAt: widened(range) },
        include: { supplier: true },
        orderBy: { number: 'asc' },
      });
      const receipts = rows.flatMap((row) => {
        const branch = branchOf.get(row.branchId);
        if (!branch || !row.receivedAt) return [];
        const date = businessDateOf(branch, row.receivedAt);
        if (!inRange(date, range)) return [];
        return [
          {
            id: `grn:${row.id}`,
            purchaseOrderId: row.id,
            number: row.number,
            brandId: row.brandId,
            branchId: row.branchId,
            businessDate: date,
            receivedAt: row.receivedAt.toISOString(),
            invoiceNumber: row.invoiceNumber,
            total: text(row.receivedTotal ?? row.total),
            supplier: {
              id: row.supplier.id,
              name: row.supplier.name,
              paymentDays: row.supplier.paymentDays,
            },
          },
        ];
      });
      return { from: range.from, to: range.to, receipts };
    },
  };
}

export type AccountingService = ReturnType<typeof createAccountingService>;
