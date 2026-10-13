import {
  CASH,
  type CloseShiftRequest,
  fromMils,
  localizedTextSchema,
  type OpenShiftRequest,
  type Page,
  type Shift,
  type ShiftFigures,
  type ShiftListQuery,
  type ShiftReport,
  type ShiftSummary,
  type ShiftVoids,
  toMils,
} from '@pos/shared';
import type { Prisma, Shift as ShiftRow } from '../../generated/prisma/client';
import { type AuditEvent, writeAudit } from '../../lib/audit';
import { errors } from '../../lib/http-errors';
import { splitPage } from '../../lib/pagination';
import type { PrismaClient } from '../../lib/prisma';
import type { RequestMeta } from '../../lib/request-meta';
import type { ActorContext } from '../../middleware/authenticate';
import type { ScopedClient } from '../../tenancy/scoped-client';

export interface ShiftsDeps {
  prisma: PrismaClient;
  now: () => Date;
}

const mils = (value: Prisma.Decimal): number => toMils(value.toFixed(3));
const iso = (value: Date | null) => (value ? value.toISOString() : null);
const money = (value: Prisma.Decimal | null) => (value ? value.toFixed(3) : null);

function toShift(row: ShiftRow): Shift {
  return {
    id: row.id,
    brandId: row.brandId,
    branchId: row.branchId,
    status: row.status,
    openedById: row.openedById,
    openedByName: row.openedByName,
    openedAt: row.openedAt.toISOString(),
    openingCash: row.openingCash.toFixed(3),
    closedById: row.closedById,
    closedByName: row.closedByName,
    closedAt: iso(row.closedAt),
    countedCash: money(row.countedCash),
    expectedCash: money(row.expectedCash),
    difference: money(row.difference),
    note: row.note,
  };
}

// A cashier's shifts. See docs/specs/010-shifts.md.
export function createShiftsService({ prisma, now }: ShiftsDeps) {
  const audit = (event: AuditEvent, meta: RequestMeta) =>
    writeAudit(prisma, { ...event, ip: meta.ip, userAgent: meta.userAgent });

  // The sales of a shift from its payments (rule 8). The cash expected is what the drawer should
  // hold now: the opening cash plus the cash taken (rule 4).
  async function figuresOf(db: ScopedClient, shift: ShiftRow): Promise<ShiftFigures> {
    const payments = await db.payment.findMany({
      where: { shiftId: shift.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const orderIds = [...new Set(payments.map((payment) => payment.orderId))];
    const orders =
      orderIds.length === 0
        ? []
        : await db.order.findMany({
            where: { id: { in: orderIds } },
            select: { total: true, discountAmount: true },
          });

    const byMethod = new Map<string, { name: unknown; amount: number }>();
    for (const payment of payments) {
      const entry = byMethod.get(payment.method) ?? { name: payment.methodName, amount: 0 };
      entry.amount += mils(payment.amount);
      byMethod.set(payment.method, entry);
    }
    const cash = byMethod.get(CASH)?.amount ?? 0;

    // Money given back during the shift (spec 011, rule 6). Cash refunds leave the drawer.
    const refunds = await db.refund.findMany({
      where: { shiftId: shift.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const refundsByMethod = new Map<string, { name: unknown; amount: number }>();
    for (const refund of refunds) {
      const entry = refundsByMethod.get(refund.method) ?? { name: refund.methodName, amount: 0 };
      entry.amount += mils(refund.amount);
      refundsByMethod.set(refund.method, entry);
    }
    const cashBack = refundsByMethod.get(CASH)?.amount ?? 0;

    return {
      ordersPaid: orderIds.length,
      sales: fromMils(orders.reduce((sum, order) => sum + mils(order.total), 0)),
      discounts: fromMils(orders.reduce((sum, order) => sum + mils(order.discountAmount), 0)),
      byMethod: [...byMethod].map(([method, entry]) => ({
        method,
        methodName: localizedTextSchema.parse(entry.name),
        amount: fromMils(entry.amount),
      })),
      refunds: fromMils(refunds.reduce((sum, refund) => sum + mils(refund.amount), 0)),
      refundsByMethod: [...refundsByMethod].map(([method, entry]) => ({
        method,
        methodName: localizedTextSchema.parse(entry.name),
        amount: fromMils(entry.amount),
      })),
      cashExpected: fromMils(mils(shift.openingCash) + cash - cashBack),
    };
  }

  // What the person voided at the branch while the shift was open (rule 8).
  async function voidsOf(db: ScopedClient, shift: ShiftRow): Promise<ShiftVoids> {
    const window = { gte: shift.openedAt, ...(shift.closedAt ? { lte: shift.closedAt } : {}) };
    const orders = await db.order.findMany({
      where: { branchId: shift.branchId, voidedById: shift.openedById, voidedAt: window },
      select: { total: true },
    });
    const lines = await db.orderLine.findMany({
      where: { branchId: shift.branchId, voidedById: shift.openedById, voidedAt: window },
      select: { lineTotal: true },
    });
    return {
      orders: orders.length,
      ordersValue: fromMils(orders.reduce((sum, order) => sum + mils(order.total), 0)),
      lines: lines.length,
      linesValue: fromMils(lines.reduce((sum, line) => sum + mils(line.lineTotal), 0)),
    };
  }

  const summaryOf = async (db: ScopedClient, row: ShiftRow): Promise<ShiftSummary> => ({
    ...toShift(row),
    figures: await figuresOf(db, row),
  });

  const reportOf = async (db: ScopedClient, row: ShiftRow): Promise<ShiftReport> => ({
    ...(await summaryOf(db, row)),
    voids: await voidsOf(db, row),
  });

  // A shift the person cannot see is answered like one that does not exist. Another person's
  // shift needs the right to see shifts.
  async function load({ auth, db }: ActorContext, id: string): Promise<ShiftRow> {
    const shift = await db.shift.findUnique({ where: { id } });
    if (!shift) throw errors.notFound('Shift');
    if (shift.openedById !== auth.sub && !auth.permissions.includes('shifts:read')) {
      throw errors.forbidden();
    }
    return shift;
  }

  const nameOf = async (userId: string) =>
    (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? '';

  return {
    // Opens a shift for the person at the branch (rules 1 and 3).
    async open(
      ctx: ActorContext,
      input: OpenShiftRequest,
      meta: RequestMeta,
    ): Promise<ShiftSummary> {
      const { auth, db } = ctx;
      const branch = await db.branch.findUnique({ where: { id: input.branchId } });
      if (!branch) throw errors.notFound('Branch');
      const brand = await db.brand.findUnique({ where: { id: branch.brandId } });
      if (!branch.isActive || !brand?.isActive) throw errors.branchInactive();

      const open = await db.shift.findFirst({
        where: { branchId: branch.id, openedById: auth.sub, status: 'open' },
      });
      if (open) throw errors.conflict('SHIFT_ALREADY_OPEN', 'You already have an open shift here');

      const row = await db.shift.create({
        data: {
          brandId: branch.brandId,
          branchId: branch.id,
          openedById: auth.sub,
          openedByName: await nameOf(auth.sub),
          openedAt: now(),
          openingCash: input.openingCash,
        },
      });
      await audit(
        {
          action: 'shift.opened',
          userId: auth.sub,
          brandId: branch.brandId,
          branchId: branch.id,
          entityType: 'shift',
          entityId: row.id,
          metadata: { openingCash: input.openingCash },
        },
        meta,
      );
      return summaryOf(db, row);
    },

    // The person's open shift at the branch, or null (rule 6).
    async current({ auth, db }: ActorContext, branchId: string): Promise<ShiftSummary | null> {
      const row = await db.shift.findFirst({
        where: { branchId, openedById: auth.sub, status: 'open' },
      });
      return row ? summaryOf(db, row) : null;
    },

    // The shifts of a branch, open ones first, then newest first (rule 9).
    async list({ db }: ActorContext, query: ShiftListQuery): Promise<Page<ShiftSummary>> {
      // A branch the person cannot see is answered like one that does not exist.
      const branch = await db.branch.findUnique({ where: { id: query.branchId } });
      if (!branch) throw errors.notFound('Branch');
      const rows = await db.shift.findMany({
        where: { branchId: query.branchId, ...(query.status ? { status: query.status } : {}) },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        orderBy: [{ status: 'asc' }, { openedAt: 'desc' }, { id: 'desc' }],
      });
      const page = splitPage(rows, query.limit);
      const data: ShiftSummary[] = [];
      for (const row of page.rows) data.push(await summaryOf(db, row));
      return { data, nextCursor: page.nextCursor };
    },

    async get(ctx: ActorContext, id: string): Promise<ShiftReport> {
      return reportOf(ctx.db, await load(ctx, id));
    },

    // Counts the drawer and closes the shift (rules 5 and 7).
    async close(
      ctx: ActorContext,
      id: string,
      input: CloseShiftRequest,
      meta: RequestMeta,
    ): Promise<ShiftReport> {
      const { auth, db } = ctx;
      const shift = await load(ctx, id);
      if (shift.status !== 'open') throw errors.conflict('SHIFT_NOT_OPEN', 'This shift is closed');

      const { cashExpected } = await figuresOf(db, shift);
      const difference = fromMils(toMils(input.countedCash) - toMils(cashExpected));
      const at = now();
      const closed = await db.shift.update({
        where: { id },
        data: {
          status: 'closed',
          closedById: auth.sub,
          closedByName: await nameOf(auth.sub),
          closedAt: at,
          countedCash: input.countedCash,
          expectedCash: cashExpected,
          difference,
          note: input.note ?? null,
        },
      });
      await audit(
        {
          action: 'shift.closed',
          userId: auth.sub,
          brandId: shift.brandId,
          branchId: shift.branchId,
          entityType: 'shift',
          entityId: id,
          metadata: {
            openedById: shift.openedById,
            countedCash: input.countedCash,
            expectedCash: cashExpected,
            difference,
          },
        },
        meta,
      );
      return reportOf(db, closed);
    },
  };
}

export type ShiftsService = ReturnType<typeof createShiftsService>;
