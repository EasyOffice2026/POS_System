import {
  activePaymentMethods,
  type AddOrderLineRequest,
  type BranchMenu,
  type BrandSettings,
  businessDateOn,
  CASH,
  CASH_NAME,
  type CreateOrderRequest,
  fromMils,
  MAX_ORDER_LINES,
  parseBranchConfig,
  parseBrandSettings,
  voidNeedsApproval,
  withinCashierLimit,
  type Order,
  type OrderListQuery,
  type OrderSummary,
  type Page,
  type PayOrderRequest,
  type RemoveDiscountRequest,
  type SetDiscountRequest,
  type UpdateOrderLineRequest,
  type UpdateOrderRequest,
  toMils,
  type VoidRequest,
} from '@pos/shared';
import type {
  Branch as BranchRow,
  OrderLine as LineRow,
  Order as OrderRow,
  Prisma,
} from '../../generated/prisma/client';
import { type AuditEvent, writeAudit } from '../../lib/audit';
import { errors } from '../../lib/http-errors';
import { splitPage } from '../../lib/pagination';
import type { PasswordHasher } from '../../lib/password';
import type { PrismaClient } from '../../lib/prisma';
import type { RequestMeta } from '../../lib/request-meta';
import type { ActorContext } from '../../middleware/authenticate';
import type { ScopedClient } from '../../tenancy/scoped-client';
import { createApprovals } from './approvals';
import {
  dbDate,
  isNotFound,
  isUniqueViolation,
  mils,
  type OrderTx,
  toOrder,
  toSummary,
  totalsOf,
} from './orders.common';
import { priceLine } from './pricing';

export interface OrdersDeps {
  prisma: PrismaClient;
  hasher: PasswordHasher;
  // The menu of a branch as its terminal loads it (spec 004), which is what prices a line.
  loadMenu: (ctx: ActorContext, branchId: string) => Promise<BranchMenu>;
  now: () => Date;
}

const notOpen = () => errors.conflict('ORDER_NOT_OPEN', 'This order is not open');

// Orders at a branch. See docs/specs/005-orders.md.
export function createOrdersService({ prisma, hasher, loadMenu, now }: OrdersDeps) {
  const audit = (event: AuditEvent, meta: RequestMeta) =>
    writeAudit(prisma, { ...event, ip: meta.ip, userAgent: meta.userAgent });
  const approvals = createApprovals({ prisma, hasher, audit });

  // A branch that takes orders: the person can see it, and it and its brand are active.
  async function openBranch(db: Pick<OrderTx, 'branch' | 'brand'>, branchId: string) {
    const branch = await db.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw errors.notFound('Branch');
    const brand = await db.brand.findUnique({ where: { id: branch.brandId } });
    if (!branch.isActive || !brand?.isActive) throw errors.branchInactive();
    return branch;
  }

  // The settings of the brand, which say what a cashier may do alone (docs/specs/009-settings.md).
  async function settingsOf(db: Pick<OrderTx, 'brand'>, brandId: string): Promise<BrandSettings> {
    const brand = await db.brand.findUnique({ where: { id: brandId } });
    return parseBrandSettings(brand?.settings);
  }

  const readLines = (db: Pick<OrderTx, 'orderLine'>, orderId: string) =>
    db.orderLine.findMany({ where: { orderId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });

  async function describe(
    db: Pick<OrderTx, 'orderLine' | 'payment' | 'kitchenTicket'>,
    row: OrderRow,
  ): Promise<Order> {
    const lines = await readLines(db, row.id);
    const payments = await db.payment.findMany({
      where: { orderId: row.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const tickets = await db.kitchenTicket.findMany({
      where: { orderId: row.id },
      select: { id: true, status: true },
    });
    return toOrder(
      row,
      lines,
      payments,
      new Map(tickets.map((ticket) => [ticket.id, ticket.status])),
    );
  }

  // Puts the lines that were not sent on a new kitchen ticket (spec 008, rule 1). Answers how many
  // lines it sent.
  async function sendPending(tx: OrderTx, order: OrderRow, at: Date): Promise<number> {
    const pending = await tx.orderLine.findMany({
      where: { orderId: order.id, status: 'pending' },
      select: { id: true, itemId: true },
    });
    if (pending.length === 0) return 0;

    // With kitchen stations, each line goes to the station of its category; a line without one,
    // and a combo, go to the first station (spec 009, rule 6). Without stations, one ticket.
    const stations = (await settingsOf(tx, order.brandId)).kitchenStations;
    const lineIdsByStation = new Map<string | null, string[]>();
    const first = stations[0];
    if (!first) {
      lineIdsByStation.set(
        null,
        pending.map((line) => line.id),
      );
    } else {
      const itemIds = pending.flatMap((line) => (line.itemId ? [line.itemId] : []));
      const items =
        itemIds.length === 0
          ? []
          : await tx.menuItem.findMany({
              where: { id: { in: itemIds } },
              select: { id: true, categoryId: true },
            });
      const categories = await tx.menuCategory.findMany({
        where: { id: { in: [...new Set(items.map((item) => item.categoryId))] } },
        select: { id: true, stationId: true },
      });
      const categoryOfItem = new Map(items.map((item) => [item.id, item.categoryId]));
      const stationOfCategory = new Map(
        categories.map((category) => [category.id, category.stationId]),
      );
      const known = new Set(stations.map((station) => station.id));
      for (const line of pending) {
        const category = line.itemId ? categoryOfItem.get(line.itemId) : undefined;
        const stationId = category ? stationOfCategory.get(category) : null;
        const target = stationId && known.has(stationId) ? stationId : first.id;
        lineIdsByStation.set(target, [...(lineIdsByStation.get(target) ?? []), line.id]);
      }
    }

    for (const [stationId, lineIds] of lineIdsByStation) {
      const ticket = await tx.kitchenTicket.create({
        data: {
          orderId: order.id,
          brandId: order.brandId,
          branchId: order.branchId,
          stationId,
          sentAt: at,
        },
      });
      await tx.orderLine.updateMany({
        where: { id: { in: lineIds } },
        data: { status: 'sent', sentAt: at, ticketId: ticket.id },
      });
    }
    return pending.length;
  }

  // An order the person cannot see is answered like one that does not exist.
  async function load(db: Pick<OrderTx, 'order'>, id: string): Promise<OrderRow> {
    const order = await db.order.findUnique({ where: { id } });
    if (!order) throw errors.notFound('Order');
    return order;
  }

  // Takes the lock on the order for this change, then checks that it can still change. Raising
  // the version first is what locks the row (rule 11).
  async function lockOpen(tx: OrderTx, id: string): Promise<OrderRow> {
    let order: OrderRow;
    try {
      order = await tx.order.update({ where: { id }, data: { version: { increment: 1 } } });
    } catch (error) {
      if (isNotFound(error)) throw errors.notFound('Order');
      throw error;
    }
    if (order.status !== 'open') throw notOpen();
    await openBranch(tx, order.branchId);
    return order;
  }

  // Puts the totals right after the lines or the discount changed (rules 9 and 10).
  async function settle(tx: OrderTx, order: OrderRow): Promise<Order> {
    const lines = await readLines(tx, order.id);
    const { subtotal, discount, total } = totalsOf(order, lines);
    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        subtotal: fromMils(subtotal),
        discountAmount: fromMils(discount),
        total: fromMils(total),
      },
    });
    return describe(tx, updated);
  }

  async function lineOf(db: Pick<OrderTx, 'orderLine'>, orderId: string, lineId: string) {
    const line = await db.orderLine.findUnique({ where: { id: lineId } });
    if (!line || line.orderId !== orderId) throw errors.notFound('Order line');
    return line;
  }

  // A line that was not sent yet, which the cashier may still change or remove (rule 6).
  function assertPending(line: LineRow) {
    if (line.status === 'sent') {
      throw errors.conflict('LINE_ALREADY_SENT', 'This line was sent to the kitchen');
    }
    if (line.status === 'voided') throw errors.conflict('LINE_VOIDED', 'This line is voided');
  }

  // A line that was sent, which can only be voided (rule 7).
  function assertVoidable(line: LineRow) {
    if (line.status === 'pending') {
      throw errors.conflict('LINE_NOT_SENT', 'Remove a line that was not sent instead');
    }
    if (line.status === 'voided') throw errors.conflict('LINE_VOIDED', 'This line is voided');
  }

  // The next number at a branch on a business date. Two orders opened at the same moment get two
  // numbers: the counter is raised in one statement, and a first order of the day that loses the
  // race to create the counter tries again (rule 2).
  async function nextNumber(
    db: Pick<ScopedClient, 'orderCounter'>,
    branch: BranchRow,
    date: string,
  ): Promise<number> {
    const businessDate = dbDate(date);
    for (let attempt = 1; ; attempt += 1) {
      try {
        const counter = await db.orderCounter.upsert({
          where: { branchId_businessDate: { branchId: branch.id, businessDate } },
          create: { branchId: branch.id, brandId: branch.brandId, businessDate, lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
        });
        return counter.lastNumber;
      } catch (error) {
        if (!isUniqueViolation(error) || attempt >= 5) throw error;
      }
    }
  }

  // The order an id made on the terminal already belongs to, when it was sent before (rule 12).
  async function existingOrder(db: ScopedClient, id: string, branchId: string) {
    const existing = await db.order.findUnique({ where: { id } });
    if (!existing) return null;
    if (existing.branchId !== branchId) {
      throw errors.conflict('ORDER_ID_TAKEN', 'This order id is already used');
    }
    return existing;
  }

  return {
    async list({ db }: ActorContext, query: OrderListQuery): Promise<Page<OrderSummary>> {
      const where: Prisma.OrderWhereInput = {
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.businessDate ? { businessDate: dbDate(query.businessDate) } : {}),
      };
      const rows = await db.order.findMany({
        where,
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        // Newest first.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const page = splitPage(rows, query.limit);

      const counts =
        page.rows.length === 0
          ? []
          : await db.orderLine.groupBy({
              by: ['orderId'],
              where: { orderId: { in: page.rows.map((row) => row.id) }, status: { not: 'voided' } },
              _count: { _all: true },
            });
      const countOf = new Map(counts.map((count) => [count.orderId, count._count._all]));

      return {
        data: page.rows.map((row) => toSummary(row, countOf.get(row.id) ?? 0)),
        nextCursor: page.nextCursor,
      };
    },

    async get({ db }: ActorContext, id: string): Promise<Order> {
      return describe(db, await load(db, id));
    },

    // Opens an order. Sending the same id again gives back the order that is already there.
    async create(
      { auth, db }: ActorContext,
      input: CreateOrderRequest,
    ): Promise<{ order: Order; created: boolean }> {
      if (input.id) {
        const existing = await existingOrder(db, input.id, input.branchId);
        if (existing) return { order: await describe(db, existing), created: false };
      }

      const branch = await openBranch(db, input.branchId);
      const businessDate = businessDateOn(
        now(),
        branch.timezone,
        parseBranchConfig(branch.config).dayEndsAt,
      );
      const number = await nextNumber(db, branch, businessDate);

      try {
        const row = await db.order.create({
          data: {
            ...(input.id ? { id: input.id } : {}),
            brandId: branch.brandId,
            branchId: branch.id,
            businessDate: dbDate(businessDate),
            number,
            type: input.type,
            note: input.note ?? null,
            openedById: auth.sub,
          },
        });
        return { order: toOrder(row, []), created: true };
      } catch (error) {
        // The same order sent twice at the same moment: the first one made it.
        if (input.id && isUniqueViolation(error)) {
          const existing = await existingOrder(db, input.id, input.branchId);
          if (existing) return { order: await describe(db, existing), created: false };
          // The id belongs to an order this person cannot see.
          throw errors.conflict('ORDER_ID_TAKEN', 'This order id is already used');
        }
        throw error;
      }
    },

    async update(ctx: ActorContext, id: string, input: UpdateOrderRequest): Promise<Order> {
      return ctx.db.$transaction(async (tx) => {
        await lockOpen(tx, id);
        const row = await tx.order.update({
          where: { id },
          data: {
            ...(input.type ? { type: input.type } : {}),
            ...(input.note !== undefined ? { note: input.note } : {}),
          },
        });
        return describe(tx, row);
      });
    },

    async addLine(ctx: ActorContext, orderId: string, input: AddOrderLineRequest): Promise<Order> {
      const { db } = ctx;
      const current = await load(db, orderId);

      // A line sent again with the id the terminal made is already there (rule 12).
      const repeated = async () => {
        if (!input.id) return null;
        const existing = await db.orderLine.findUnique({ where: { id: input.id } });
        if (!existing) return null;
        if (existing.orderId !== orderId) {
          throw errors.conflict('LINE_ID_TAKEN', 'This line id is already used');
        }
        return describe(db, await load(db, orderId));
      };
      const before = await repeated();
      if (before) return before;

      if (current.status !== 'open') throw notOpen();
      const priced = priceLine(await loadMenu(ctx, current.branchId), input, now());

      try {
        return await db.$transaction(async (tx) => {
          const order = await lockOpen(tx, orderId);
          const count = await tx.orderLine.count({ where: { orderId } });
          if (count >= MAX_ORDER_LINES) {
            throw errors.conflict('ORDER_FULL', `An order holds at most ${MAX_ORDER_LINES} lines`);
          }
          const last = await tx.orderLine.findFirst({
            where: { orderId },
            orderBy: { position: 'desc' },
            select: { position: true },
          });
          const details = { modifiers: priced.modifiers, choices: priced.choices };

          await tx.orderLine.create({
            data: {
              ...(input.id ? { id: input.id } : {}),
              orderId,
              brandId: order.brandId,
              branchId: order.branchId,
              kind: priced.kind,
              itemId: priced.itemId,
              comboId: priced.comboId,
              name: priced.name,
              unitPrice: fromMils(priced.unitMils),
              quantity: input.quantity,
              lineTotal: fromMils(priced.unitMils * input.quantity),
              details: details as unknown as Prisma.InputJsonObject,
              note: input.note ?? null,
              position: (last?.position ?? -1) + 1,
            },
          });
          return settle(tx, order);
        });
      } catch (error) {
        if (input.id && isUniqueViolation(error)) {
          const after = await repeated();
          if (after) return after;
          // The id belongs to a line this person cannot see.
          throw errors.conflict('LINE_ID_TAKEN', 'This line id is already used');
        }
        throw error;
      }
    },

    async updateLine(
      ctx: ActorContext,
      orderId: string,
      lineId: string,
      input: UpdateOrderLineRequest,
    ): Promise<Order> {
      return ctx.db.$transaction(async (tx) => {
        const order = await lockOpen(tx, orderId);
        const line = await lineOf(tx, orderId, lineId);
        assertPending(line);

        const quantity = input.quantity ?? line.quantity;
        await tx.orderLine.update({
          where: { id: lineId },
          data: {
            quantity,
            lineTotal: fromMils(mils(line.unitPrice) * quantity),
            ...(input.note !== undefined ? { note: input.note } : {}),
          },
        });
        return settle(tx, order);
      });
    },

    // A line that was never sent leaves no trace in the kitchen, so it can simply go.
    async removeLine(ctx: ActorContext, orderId: string, lineId: string): Promise<Order> {
      return ctx.db.$transaction(async (tx) => {
        const order = await lockOpen(tx, orderId);
        assertPending(await lineOf(tx, orderId, lineId));
        await tx.orderLine.delete({ where: { id: lineId } });
        return settle(tx, order);
      });
    },

    // Sends every line that was not sent yet. The kitchen screen (a later epic) picks them up.
    async send(ctx: ActorContext, orderId: string): Promise<Order> {
      return ctx.db.$transaction(async (tx) => {
        const order = await lockOpen(tx, orderId);
        if ((await sendPending(tx, order, now())) === 0) {
          throw errors.conflict('NOTHING_TO_SEND', 'Every line of this order was sent already');
        }
        return describe(tx, order);
      });
    },

    async voidLine(
      ctx: ActorContext,
      orderId: string,
      lineId: string,
      input: VoidRequest,
      meta: RequestMeta,
    ): Promise<Order> {
      const { auth, db } = ctx;
      const order = await load(db, orderId);
      if (order.status !== 'open') throw notOpen();
      assertVoidable(await lineOf(db, orderId, lineId));

      // A sent line: the brand's rule says whether a manager is needed (spec 009, rule 5).
      const approvedById = voidNeedsApproval(await settingsOf(db, order.brandId), true)
        ? await approvals.authorize(ctx, order, 'orders:void', input.approval, meta)
        : null;

      const { result, line } = await db.$transaction(async (tx) => {
        const locked = await lockOpen(tx, orderId);
        const target = await lineOf(tx, orderId, lineId);
        assertVoidable(target);
        await tx.orderLine.update({
          where: { id: lineId },
          data: {
            status: 'voided',
            voidedAt: now(),
            voidedById: auth.sub,
            voidReason: input.reason,
            voidApprovedById: approvedById,
          },
        });
        return { result: await settle(tx, locked), line: target };
      });

      await audit(
        {
          action: 'order.line_voided',
          userId: auth.sub,
          brandId: order.brandId,
          branchId: order.branchId,
          entityType: 'order',
          entityId: orderId,
          metadata: {
            number: order.number,
            businessDate: result.businessDate,
            lineId,
            name: line.name as Prisma.InputJsonObject,
            quantity: line.quantity,
            lineTotal: line.lineTotal.toFixed(3),
            reason: input.reason,
            approvedById,
          },
        },
        meta,
      );
      return result;
    },

    async voidOrder(
      ctx: ActorContext,
      orderId: string,
      input: VoidRequest,
      meta: RequestMeta,
    ): Promise<Order> {
      const { auth, db } = ctx;
      const order = await load(db, orderId);
      if (order.status !== 'open') throw notOpen();

      // The brand's rule says whether a manager is needed, which may depend on whether anything
      // was sent to the kitchen (spec 009, rule 5).
      const settings = await settingsOf(db, order.brandId);
      const sentLines = (where: Pick<OrderTx, 'orderLine'>) =>
        where.orderLine.count({ where: { orderId, sentAt: { not: null } } });
      const anySent = (await sentLines(db)) > 0;
      const needs = voidNeedsApproval(settings, anySent);
      const approvedById = needs
        ? await approvals.authorize(ctx, order, 'orders:void', input.approval, meta)
        : null;

      const result = await db.$transaction(async (tx) => {
        await lockOpen(tx, orderId);
        // A line sent in the meantime may need the right after all.
        const sentNow = await sentLines(tx);
        if (
          !needs &&
          voidNeedsApproval(settings, sentNow > 0) &&
          !auth.permissions.includes('orders:void')
        ) {
          throw errors.validation([{ path: 'approval', message: 'APPROVAL_REQUIRED' }]);
        }
        const row = await tx.order.update({
          where: { id: orderId },
          data: {
            status: 'voided',
            voidedAt: now(),
            voidedById: auth.sub,
            voidReason: input.reason,
            voidApprovedById: approvedById,
          },
        });
        return { order: await describe(tx, row), sent: sentNow };
      });

      await audit(
        {
          action: 'order.voided',
          userId: auth.sub,
          brandId: order.brandId,
          branchId: order.branchId,
          entityType: 'order',
          entityId: orderId,
          metadata: {
            number: order.number,
            businessDate: result.order.businessDate,
            total: result.order.total,
            sentLines: result.sent,
            reason: input.reason,
            approvedById,
          },
        },
        meta,
      );
      return result.order;
    },

    async setDiscount(
      ctx: ActorContext,
      orderId: string,
      input: SetDiscountRequest,
      meta: RequestMeta,
    ): Promise<Order> {
      const { auth, db } = ctx;
      const order = await load(db, orderId);
      if (order.status !== 'open') throw notOpen();

      // A percentage within the cashier's limit needs no manager (spec 009, rule 3).
      const approvedById = withinCashierLimit(await settingsOf(db, order.brandId), input)
        ? null
        : await approvals.authorize(ctx, order, 'orders:discount', input.approval, meta);

      const result = await db.$transaction(async (tx) => {
        await lockOpen(tx, orderId);
        const row = await tx.order.update({
          where: { id: orderId },
          data: {
            discountKind: input.kind,
            discountValue: input.value,
            discountReason: input.reason,
            discountById: auth.sub,
            discountApprovedById: approvedById,
          },
        });
        return settle(tx, row);
      });

      await audit(
        {
          action: 'order.discount_set',
          userId: auth.sub,
          brandId: order.brandId,
          branchId: order.branchId,
          entityType: 'order',
          entityId: orderId,
          metadata: {
            number: order.number,
            kind: input.kind,
            value: input.value,
            amount: result.discount?.amount ?? '0.000',
            reason: input.reason,
            approvedById,
          },
        },
        meta,
      );
      return result;
    },

    async removeDiscount(
      ctx: ActorContext,
      orderId: string,
      input: RemoveDiscountRequest,
      meta: RequestMeta,
    ): Promise<Order> {
      const { auth, db } = ctx;
      const order = await load(db, orderId);
      if (order.status !== 'open') throw notOpen();
      // Nothing to remove, so nothing to allow and nothing to record.
      if (!order.discountKind) return describe(db, order);

      // Taking back a discount the cashier could give alone needs no manager either.
      const given = {
        kind: order.discountKind,
        value: order.discountValue?.toFixed(order.discountKind === 'percent' ? 2 : 3) ?? '0',
      };
      const approvedById = withinCashierLimit(await settingsOf(db, order.brandId), given)
        ? null
        : await approvals.authorize(ctx, order, 'orders:discount', input.approval, meta);

      const result = await db.$transaction(async (tx) => {
        await lockOpen(tx, orderId);
        const row = await tx.order.update({
          where: { id: orderId },
          data: {
            discountKind: null,
            discountValue: null,
            discountReason: null,
            discountById: null,
            discountApprovedById: null,
          },
        });
        return settle(tx, row);
      });

      await audit(
        {
          action: 'order.discount_removed',
          userId: auth.sub,
          brandId: order.brandId,
          branchId: order.branchId,
          entityType: 'order',
          entityId: orderId,
          metadata: {
            number: order.number,
            kind: order.discountKind,
            value: order.discountValue?.toFixed(order.discountKind === 'percent' ? 2 : 3) ?? null,
            approvedById,
          },
        },
        meta,
      );
      return result;
    },

    // Takes the whole payment and closes the order. See docs/specs/007-payments.md.
    async pay(ctx: ActorContext, orderId: string, input: PayOrderRequest): Promise<Order> {
      const { auth, db } = ctx;
      const ids = input.tenders.map((tender) => tender.id);

      // The same payment sent again: the order was paid with these parts already (rule 7).
      const repeated = async () => {
        if (ids.length === 0) return null;
        const found = await db.payment.findMany({ where: { id: { in: ids } } });
        if (found.length === 0) return null;
        if (found.some((payment) => payment.orderId !== orderId)) {
          throw errors.conflict('PAYMENT_ID_TAKEN', 'This payment id is already used');
        }
        return describe(db, await load(db, orderId));
      };
      const before = await repeated();
      if (before) return before;

      // Every way to pay must be cash or one of the brand's active methods (spec 009, rule 2).
      const methods = new Map(
        activePaymentMethods(await settingsOf(db, (await load(db, orderId)).brandId)).map(
          (method) => [method.key, method.name],
        ),
      );
      const unknown = input.tenders.findIndex(
        (tender) => tender.method !== CASH && !methods.has(tender.method),
      );
      if (unknown >= 0) {
        throw errors.validation([
          { path: `tenders.${unknown}.method`, message: 'PAYMENT_METHOD_INVALID' },
        ]);
      }

      try {
        return await db.$transaction(async (tx) => {
          const order = await lockOpen(tx, orderId);
          const lines = await readLines(tx, orderId);
          if (!lines.some((line) => line.status !== 'voided')) {
            throw errors.conflict('ORDER_EMPTY', 'This order has nothing to pay for');
          }

          // The parts pay the total of the order as it is now, to the last decimal (rule 8).
          const total = mils(order.total);
          if (total > 0 && input.tenders.length === 0) {
            throw errors.validation([{ path: 'tenders', message: 'PAYMENT_TENDERS_INVALID' }]);
          }
          const paid = input.tenders.reduce((sum, tender) => sum + toMils(tender.amount), 0);
          if (paid !== total) {
            throw errors.validation([{ path: 'tenders', message: 'PAYMENT_TOTAL_MISMATCH' }]);
          }

          // The payment goes into the open shift of the person taking it (spec 010, rule 2).
          const shift = await tx.shift.findFirst({
            where: { branchId: order.branchId, openedById: auth.sub, status: 'open' },
            select: { id: true },
          });
          if (!shift)
            throw errors.conflict('SHIFT_REQUIRED', 'Open a shift before taking payments');

          // What was not sent yet goes to the kitchen now (rule 5).
          const at = now();
          await sendPending(tx, order, at);
          await tx.payment.createMany({
            data: input.tenders.map((tender) => ({
              id: tender.id,
              orderId,
              brandId: order.brandId,
              branchId: order.branchId,
              method: tender.method,
              methodName: tender.method === CASH ? CASH_NAME : (methods.get(tender.method) ?? {}),
              amount: tender.amount,
              tendered: tender.method === CASH ? (tender.tendered ?? tender.amount) : null,
              change:
                tender.method === CASH
                  ? fromMils(toMils(tender.tendered ?? tender.amount) - toMils(tender.amount))
                  : '0',
              reference: tender.method === CASH ? null : (tender.reference ?? null),
              takenById: auth.sub,
              shiftId: shift.id,
              createdAt: at,
            })),
          });
          const closed = await tx.order.update({
            where: { id: orderId },
            data: { status: 'paid', paidAt: at, paidById: auth.sub },
          });
          return describe(tx, closed);
        });
      } catch (error) {
        // Sent twice at the same moment: the first one was taken.
        if (isUniqueViolation(error)) {
          const after = await repeated();
          if (after) return after;
          throw errors.conflict('PAYMENT_ID_TAKEN', 'This payment id is already used');
        }
        throw error;
      }
    },
  };
}

export type OrdersService = ReturnType<typeof createOrdersService>;
