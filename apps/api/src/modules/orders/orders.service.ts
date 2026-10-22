import {
  activePaymentMethods,
  type AddOrderLineRequest,
  applyPromotions,
  type BranchMenu,
  type BrandSettings,
  customerSearchText,
  businessDateOn,
  CASH,
  CASH_NAME,
  commissionOf,
  type CreateOrderRequest,
  fromMils,
  localizedTextSchema,
  MAX_ORDER_LINES,
  maxPointsFor,
  deliveryDetailsSchema,
  type OrderType,
  parseBranchConfig,
  parseBrandSettings,
  pointsEarned,
  pointsValueMils,
  type PutOrderCustomerRequest,
  voidNeedsApproval,
  withinCashierLimit,
  type Order,
  type OrderListQuery,
  type OrderSummary,
  type Page,
  type PayOrderRequest,
  type RemoveDiscountRequest,
  type RefundRequest,
  type SetDiscountRequest,
  type UpdateOrderLineRequest,
  type UpdateOrderRequest,
  toMils,
  type VoidRequest,
} from '@pos/shared';
import {
  type Branch as BranchRow,
  type OrderLine as LineRow,
  type Order as OrderRow,
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
import { toPromotion } from '../menu/promotions.service';
import type { VoidEvent } from './void-alerts';

export interface OrdersDeps {
  prisma: PrismaClient;
  hasher: PasswordHasher;
  // The menu of a branch as its terminal loads it (spec 004), which is what prices a line.
  loadMenu: (ctx: ActorContext, branchId: string) => Promise<BranchMenu>;
  now: () => Date;
  // Takes the ingredients of the paid lines off the branch's stock (spec 013, rule 4).
  // Tells the brand's people about a void (docs/client-decisions.md).
  notifyVoid: (event: VoidEvent) => Promise<void>;
  deductStock: (
    tx: OrderTx,
    order: OrderRow,
    lines: LineRow[],
    by: { id: string; name: string | null },
    at: Date,
  ) => Promise<void>;
}

const notOpen = () => errors.conflict('ORDER_NOT_OPEN', 'This order is not open');
const tableTaken = () => errors.conflict('TABLE_TAKEN', 'Another order is open at this table');
const pointsNotEnough = () => errors.validation([{ path: 'points', message: 'POINTS_NOT_ENOUGH' }]);

// Orders at a branch. See docs/specs/005-orders.md.
export function createOrdersService({
  prisma,
  hasher,
  loadMenu,
  now,
  deductStock,
  notifyVoid,
}: OrdersDeps) {
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

  // A branch refuses an order type it has switched off (docs/specs/026-order-types.md, rule 4).
  function assertOffered(branch: { config: unknown }, type: OrderType) {
    if (!parseBranchConfig(branch.config).orderTypes[type]) {
      throw errors.conflict(
        'ORDER_TYPE_NOT_OFFERED',
        'This branch does not take this type of order',
      );
    }
  }

  // A delivery order needs its phone and address before it is sent or paid (rule 5).
  function assertDeliveryDetails(order: OrderRow) {
    if (order.type === 'delivery' && !deliveryDetailsSchema.safeParse(order.delivery).success) {
      throw errors.conflict(
        'DELIVERY_DETAILS_REQUIRED',
        'A delivery order needs a phone and an address',
      );
    }
  }

  // The settings of the brand, which say what a cashier may do alone (docs/specs/009-settings.md).
  async function settingsOf(db: Pick<OrderTx, 'brand'>, brandId: string): Promise<BrandSettings> {
    const brand = await db.brand.findUnique({ where: { id: brandId } });
    return parseBrandSettings(brand?.settings);
  }

  const readLines = (db: Pick<OrderTx, 'orderLine'>, orderId: string) =>
    db.orderLine.findMany({ where: { orderId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });

  async function describe(
    db: Pick<
      OrderTx,
      'orderLine' | 'payment' | 'kitchenTicket' | 'refund' | 'customer' | 'diningTable'
    >,
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
    const refunds = await db.refund.findMany({
      where: { orderId: row.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return toOrder(
      row,
      lines,
      payments,
      new Map(tickets.map((ticket) => [ticket.id, ticket.status])),
      refunds,
      {
        customer: row.customerId
          ? await db.customer.findUnique({ where: { id: row.customerId } })
          : null,
        table: row.tableId ? await db.diningTable.findUnique({ where: { id: row.tableId } }) : null,
      },
    );
  }

  // A table an order can go to: in use, at the order's branch, and holding no other open order
  // (docs/specs/023-floor-plan.md, rules 3 and 4).
  async function freeTable(
    db: Pick<OrderTx, 'diningTable' | 'order'>,
    branchId: string,
    tableId: string,
    orderId: string | null,
  ) {
    const table = await db.diningTable.findUnique({ where: { id: tableId } });
    if (!table || !table.isActive || table.branchId !== branchId) {
      throw errors.validation([{ path: 'tableId', message: 'TABLE_NOT_FOUND' }]);
    }
    const holder = await db.order.findUnique({ where: { tableOpenKey: tableId } });
    if (holder && holder.id !== orderId) throw tableTaken();
    return table;
  }

  // Puts the lines that were not sent on a new kitchen ticket (spec 008, rule 1). Answers how many
  // lines it sent.
  async function sendPending(tx: OrderTx, order: OrderRow, at: Date): Promise<number> {
    const pending = await tx.orderLine.findMany({
      where: { orderId: order.id, status: 'pending' },
      select: { id: true, itemId: true },
    });
    if (pending.length === 0) return 0;

    // A branch without a kitchen screen works from the printed slip: the dishes are sent, but no
    // ticket waits on a screen (docs/specs/027-kitchen-screen-and-slip.md, rule 3).
    const branch = await tx.branch.findUnique({
      where: { id: order.branchId },
      select: { config: true },
    });
    if (!parseBranchConfig(branch?.config).kitchen.screen) {
      await tx.orderLine.updateMany({
        where: { id: { in: pending.map((line) => line.id) } },
        data: { status: 'sent', sentAt: at },
      });
      return pending.length;
    }

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

  // What the brand's promotions take off the order now, from the promotions as they are
  // (docs/specs/021-promotions.md, rules 2 to 6).
  async function promotionsFor(tx: OrderTx, order: OrderRow, lines: LineRow[]) {
    const rows = await tx.promotion.findMany({ where: { brandId: order.brandId, isActive: true } });
    if (rows.length === 0) return [];
    const itemIds = [...new Set(lines.flatMap((line) => (line.itemId ? [line.itemId] : [])))];
    const items = await tx.menuItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, categoryId: true },
    });
    const categoryOf = new Map(items.map((item) => [item.id, item.categoryId]));
    const branch = await tx.branch.findUnique({ where: { id: order.branchId } });
    return applyPromotions(
      lines.map((line) => ({
        id: line.id,
        kind: line.kind,
        itemId: line.itemId,
        categoryId: line.itemId ? (categoryOf.get(line.itemId) ?? null) : null,
        quantity: line.quantity,
        unitPrice: mils(line.unitPrice),
        status: line.status,
        addedAt: line.createdAt,
      })),
      rows.map(toPromotion),
      {
        businessDate: order.businessDate.toISOString().slice(0, 10),
        branchId: order.branchId,
        timeZone: branch?.timezone ?? 'Asia/Kuwait',
        promoCode: order.promoCode,
      },
    );
  }

  // At payment: the points spent leave the customer's balance, the points earned arrive, and the
  // visit and what was spent are counted, each change with an entry (spec 022, rules 3 to 6).
  // Answers the points the order earned.
  async function loyaltyOnPay(
    tx: OrderTx,
    order: OrderRow,
    by: { id: string; name: string | null },
    at: Date,
  ): Promise<number> {
    if (!order.customerId) return 0;
    const customer = await tx.customer.findUnique({ where: { id: order.customerId } });
    if (!customer) return 0;
    const { loyalty } = await settingsOf(tx, order.brandId);
    let balance = customer.points;
    const entry = (kind: 'earn' | 'redeem', points: number) =>
      tx.loyaltyEntry.create({
        data: {
          brandId: order.brandId,
          branchId: order.branchId,
          customerId: customer.id,
          kind,
          points,
          balanceAfter: balance,
          orderId: order.id,
          note: null,
          byId: by.id,
          byName: by.name,
          createdAt: at,
        },
      });

    if (order.pointsRedeemed > 0) {
      if (balance < order.pointsRedeemed) throw pointsNotEnough();
      balance -= order.pointsRedeemed;
      await entry('redeem', -order.pointsRedeemed);
    }
    const earned = pointsEarned(mils(order.total), loyalty);
    if (earned > 0) {
      balance += earned;
      await entry('earn', earned);
    }
    await tx.customer.update({
      where: { id: customer.id },
      data: {
        points: balance,
        visits: { increment: 1 },
        totalSpent: fromMils(mils(customer.totalSpent) + mils(order.total)),
        lastVisitAt: at,
      },
    });
    return earned;
  }

  // Puts the totals right after the lines, the discount or the code changed (rules 9 and 10).
  async function settle(tx: OrderTx, order: OrderRow): Promise<Order> {
    const lines = await readLines(tx, order.id);
    const applied = await promotionsFor(tx, order, lines);
    const { loyalty } = await settingsOf(tx, order.brandId);
    const { subtotal, promotions, discount, pointsRedeemed, points, total } = totalsOf(
      order,
      lines,
      applied.reduce((sum, row) => sum + row.amount, 0),
      order.pointsRedeemed > 0 ? pointsValueMils(1, loyalty) : 0,
    );
    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        subtotal: fromMils(subtotal),
        promotionDiscount: fromMils(promotions),
        promotions: applied.map((row) => ({
          id: row.promotion.id,
          name: row.promotion.name,
          amount: fromMils(row.amount),
        })),
        discountAmount: fromMils(discount),
        pointsRedeemed,
        pointsDiscount: fromMils(points),
        total: fromMils(total),
        // The bill printed before is out of date (docs/specs/023-floor-plan.md, rule 6).
        ...(fromMils(total) === order.total.toFixed(3) ? {} : { billPrintedAt: null }),
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
      const customerIds = [
        ...new Set(page.rows.flatMap((row) => (row.customerId ? [row.customerId] : []))),
      ];
      const customers =
        customerIds.length === 0
          ? []
          : await db.customer.findMany({ where: { id: { in: customerIds } } });
      const customerOf = new Map(customers.map((customer) => [customer.id, customer]));
      const tableIds = [...new Set(page.rows.flatMap((row) => (row.tableId ? [row.tableId] : [])))];
      const tables =
        tableIds.length === 0
          ? []
          : await db.diningTable.findMany({ where: { id: { in: tableIds } } });
      const tableOf = new Map(tables.map((table) => [table.id, table]));

      return {
        data: page.rows.map((row) =>
          toSummary(row, countOf.get(row.id) ?? 0, {
            customer: row.customerId ? (customerOf.get(row.customerId) ?? null) : null,
            table: row.tableId ? (tableOf.get(row.tableId) ?? null) : null,
          }),
        ),
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
      // An order at a table is dine-in (docs/specs/023-floor-plan.md, rule 3).
      const table = input.tableId ? await freeTable(db, branch.id, input.tableId, null) : null;
      const type: OrderType = table ? 'dine_in' : input.type;
      assertOffered(branch, type);
      const number = await nextNumber(db, branch, businessDate);

      try {
        const row = await db.order.create({
          data: {
            ...(input.id ? { id: input.id } : {}),
            brandId: branch.brandId,
            branchId: branch.id,
            businessDate: dbDate(businessDate),
            number,
            type,
            note: input.note ?? null,
            ...(type === 'delivery' && input.delivery ? { delivery: input.delivery } : {}),
            openedById: auth.sub,
            ...(table ? { tableId: table.id, tableOpenKey: table.id } : {}),
          },
        });
        return { order: toOrder(row, [], [], new Map(), [], { table }), created: true };
      } catch (error) {
        // The same order sent twice at the same moment: the first one made it.
        if (input.id && isUniqueViolation(error)) {
          const existing = await existingOrder(db, input.id, input.branchId);
          if (existing) return { order: await describe(db, existing), created: false };
        }
        // Another terminal opened an order at the table first.
        if (input.tableId && isUniqueViolation(error)) throw tableTaken();
        if (input.id && isUniqueViolation(error)) {
          // The id belongs to an order this person cannot see.
          throw errors.conflict('ORDER_ID_TAKEN', 'This order id is already used');
        }
        throw error;
      }
    },

    async update(ctx: ActorContext, id: string, input: UpdateOrderRequest): Promise<Order> {
      return ctx.db.$transaction(async (tx) => {
        const current = await lockOpen(tx, id);
        const type = input.type ?? current.type;
        if (type !== current.type) assertOffered(await openBranch(tx, current.branchId), type);
        if (input.delivery && type !== 'delivery') {
          throw errors.conflict(
            'DELIVERY_NOT_APPLICABLE',
            'Only a delivery order has delivery details',
          );
        }
        const row = await tx.order.update({
          where: { id },
          data: {
            ...(input.type ? { type: input.type } : {}),
            // Only a dine-in order has a table (docs/specs/023-floor-plan.md, rule 3), and only
            // a delivery order has delivery details (docs/specs/026-order-types.md, rule 7).
            ...(type !== 'dine_in' ? { tableId: null, tableOpenKey: null } : {}),
            ...(type !== 'delivery'
              ? { delivery: Prisma.DbNull }
              : input.delivery !== undefined
                ? { delivery: input.delivery ?? Prisma.DbNull }
                : {}),
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
        assertDeliveryDetails(order);
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
      await notifyVoid({
        kind: 'line',
        brandId: order.brandId,
        branchId: order.branchId,
        orderNumber: order.number,
        what: localizedTextSchema.safeParse(line.name).data ?? null,
        quantity: line.quantity,
        amount: line.lineTotal.toFixed(3),
        reason: input.reason,
        byId: auth.sub,
        approvedById,
        at: now(),
      });
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
            tableOpenKey: null,
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
      await notifyVoid({
        kind: 'order',
        brandId: order.brandId,
        branchId: order.branchId,
        orderNumber: order.number,
        what: null,
        quantity: null,
        amount: result.order.total,
        reason: input.reason,
        byId: auth.sub,
        approvedById,
        at: now(),
      });
      return result.order;
    },

    // Puts an open order at a table, or moves it there; it becomes dine-in
    // (docs/specs/023-floor-plan.md, rules 3 to 5).
    async setTable(ctx: ActorContext, orderId: string, tableId: string): Promise<Order> {
      const { db } = ctx;
      const order = await load(db, orderId);
      if (order.status !== 'open') throw notOpen();
      assertOffered(await openBranch(db, order.branchId), 'dine_in');
      await freeTable(db, order.branchId, tableId, orderId);
      try {
        return await db.$transaction(async (tx) => {
          await lockOpen(tx, orderId);
          await freeTable(tx, order.branchId, tableId, orderId);
          const row = await tx.order.update({
            where: { id: orderId },
            data: { type: 'dine_in', tableId, tableOpenKey: tableId, delivery: Prisma.DbNull },
          });
          return describe(tx, row);
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw tableTaken();
        throw error;
      }
    },

    async removeTable(ctx: ActorContext, orderId: string): Promise<Order> {
      const { db } = ctx;
      const order = await load(db, orderId);
      if (order.status !== 'open') throw notOpen();
      if (!order.tableId) return describe(db, order);
      return db.$transaction(async (tx) => {
        await lockOpen(tx, orderId);
        const row = await tx.order.update({
          where: { id: orderId },
          data: { tableId: null, tableOpenKey: null },
        });
        return describe(tx, row);
      });
    },

    // The bill was printed for the customer: the table waits to be paid (rule 6).
    async printBill(ctx: ActorContext, orderId: string): Promise<Order> {
      return ctx.db.$transaction(async (tx) => {
        await lockOpen(tx, orderId);
        const live = await tx.orderLine.count({ where: { orderId, status: { not: 'voided' } } });
        if (live === 0) throw errors.conflict('ORDER_EMPTY', 'This order has nothing to pay for');
        const row = await tx.order.update({
          where: { id: orderId },
          data: { billPrintedAt: now() },
        });
        return describe(tx, row);
      });
    },

    // Puts a customer on an open order by phone, adding them when the phone is new; a customer
    // changed starts with no points spent (docs/specs/022-loyalty.md, rule 2).
    async setCustomer(
      ctx: ActorContext,
      orderId: string,
      input: PutOrderCustomerRequest,
      meta: RequestMeta,
    ): Promise<Order> {
      const { auth, db } = ctx;
      const order = await load(db, orderId);
      if (order.status !== 'open') throw notOpen();
      let customer = await db.customer.findFirst({
        where: { brandId: order.brandId, phone: input.phone },
      });
      let created = false;
      if (!customer) {
        try {
          customer = await db.customer.create({
            data: {
              brandId: order.brandId,
              phone: input.phone,
              name: input.name ?? null,
              searchText: customerSearchText(input.phone, input.name ?? null),
            },
          });
          created = true;
        } catch (error) {
          // Added by another terminal at the same moment.
          if (!isUniqueViolation(error)) throw error;
          customer = await db.customer.findFirst({
            where: { brandId: order.brandId, phone: input.phone },
          });
          if (!customer) throw error;
        }
        if (created) {
          await audit(
            {
              action: 'customer.created',
              userId: auth.sub,
              brandId: order.brandId,
              branchId: order.branchId,
              entityType: 'customer',
              entityId: customer.id,
              metadata: { phone: customer.phone, orderId },
            },
            meta,
          );
        }
      }
      const customerId = customer.id;
      return db.$transaction(async (tx) => {
        const locked = await lockOpen(tx, orderId);
        const row = await tx.order.update({
          where: { id: orderId },
          data: {
            customerId,
            ...(locked.customerId === customerId ? {} : { pointsRedeemed: 0 }),
          },
        });
        return settle(tx, row);
      });
    },

    async removeCustomer(ctx: ActorContext, orderId: string): Promise<Order> {
      const { db } = ctx;
      const order = await load(db, orderId);
      if (order.status !== 'open') throw notOpen();
      if (!order.customerId) return describe(db, order);
      return db.$transaction(async (tx) => {
        await lockOpen(tx, orderId);
        const row = await tx.order.update({
          where: { id: orderId },
          data: { customerId: null, pointsRedeemed: 0 },
        });
        return settle(tx, row);
      });
    },

    // Spends some of the customer's points on the order (rule 4). They leave the balance only
    // when the order is paid.
    async setPoints(ctx: ActorContext, orderId: string, points: number): Promise<Order> {
      const { db } = ctx;
      const order = await load(db, orderId);
      if (order.status !== 'open') throw notOpen();
      const { loyalty } = await settingsOf(db, order.brandId);
      if (!loyalty.enabled) throw errors.conflict('LOYALTY_OFF', 'Loyalty is off for this brand');
      const customer = order.customerId
        ? await db.customer.findUnique({ where: { id: order.customerId } })
        : null;
      if (!customer) throw errors.validation([{ path: 'points', message: 'CUSTOMER_REQUIRED' }]);
      if (points < loyalty.minRedeem) {
        throw errors.validation([{ path: 'points', message: 'POINTS_TOO_FEW' }]);
      }
      if (points > customer.points) throw pointsNotEnough();
      // What is left to pay before any points.
      const left = mils(order.total) + mils(order.pointsDiscount);
      if (points > maxPointsFor(left, loyalty)) {
        throw errors.validation([{ path: 'points', message: 'POINTS_TOO_MANY' }]);
      }
      return db.$transaction(async (tx) => {
        await lockOpen(tx, orderId);
        const row = await tx.order.update({
          where: { id: orderId },
          data: { pointsRedeemed: points },
        });
        return settle(tx, row);
      });
    },

    async removePoints(ctx: ActorContext, orderId: string): Promise<Order> {
      const { db } = ctx;
      const order = await load(db, orderId);
      if (order.status !== 'open') throw notOpen();
      if (order.pointsRedeemed === 0) return describe(db, order);
      return db.$transaction(async (tx) => {
        await lockOpen(tx, orderId);
        const row = await tx.order.update({ where: { id: orderId }, data: { pointsRedeemed: 0 } });
        return settle(tx, row);
      });
    },

    // Types a promotion code on an open order: an active promotion of the brand with that code,
    // for the order's day and branch (docs/specs/021-promotions.md, rule 5).
    async setPromoCode(ctx: ActorContext, orderId: string, code: string): Promise<Order> {
      const { db } = ctx;
      const order = await load(db, orderId);
      if (order.status !== 'open') throw notOpen();
      const day = order.businessDate.toISOString().slice(0, 10);
      const promotion = await db.promotion.findFirst({
        where: { brandId: order.brandId, code, isActive: true },
      });
      const fits =
        promotion &&
        (promotion.branchIds.length === 0 || promotion.branchIds.includes(order.branchId)) &&
        (!promotion.startsOn || day >= promotion.startsOn.toISOString().slice(0, 10)) &&
        (!promotion.endsOn || day <= promotion.endsOn.toISOString().slice(0, 10));
      if (!fits) throw errors.validation([{ path: 'code', message: 'PROMO_CODE_INVALID' }]);

      return db.$transaction(async (tx) => {
        await lockOpen(tx, orderId);
        const row = await tx.order.update({ where: { id: orderId }, data: { promoCode: code } });
        return settle(tx, row);
      });
    },

    async removePromoCode(ctx: ActorContext, orderId: string): Promise<Order> {
      const { db } = ctx;
      const order = await load(db, orderId);
      if (order.status !== 'open') throw notOpen();
      if (!order.promoCode) return describe(db, order);
      return db.$transaction(async (tx) => {
        await lockOpen(tx, orderId);
        const row = await tx.order.update({ where: { id: orderId }, data: { promoCode: null } });
        return settle(tx, row);
      });
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
      const settings = await settingsOf(db, (await load(db, orderId)).brandId);
      const methods = new Map(
        activePaymentMethods(settings).map((method) => [method.key, method.name]),
      );
      // The rate of each way to pay, kept on its payments (spec 025, rule 2).
      const rates = new Map(
        activePaymentMethods(settings).map((method) => [method.key, method.commissionRate]),
      );
      const unknown = input.tenders.findIndex(
        (tender) => tender.method !== CASH && !methods.has(tender.method),
      );
      if (unknown >= 0) {
        throw errors.validation([
          { path: `tenders.${unknown}.method`, message: 'PAYMENT_METHOD_INVALID' },
        ]);
      }

      // The name goes on the stock movements; it is read before the transaction, since the
      // database answers one request at a time while one is open.
      const by = {
        id: auth.sub,
        name:
          (await prisma.user.findUnique({ where: { id: auth.sub }, select: { name: true } }))
            ?.name ?? null,
      };

      try {
        return await db.$transaction(async (tx) => {
          const order = await lockOpen(tx, orderId);
          assertDeliveryDetails(order);
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
          // The stock goes down by what was sold, in the same transaction (spec 013, rule 4),
          // unless the brand takes it off when the kitchen starts each ticket instead.
          if (settings.stockDeductAt === 'paid') {
            await deductStock(tx, order, lines, by, at);
          } else {
            // Taken off when the kitchen starts a ticket; at a branch without a kitchen screen no
            // ticket is started, so what no kitchen started goes now (spec 027, rule 3).
            const branch = await tx.branch.findUnique({
              where: { id: order.branchId },
              select: { config: true },
            });
            if (!parseBranchConfig(branch?.config).kitchen.screen) {
              const started = new Set(
                (
                  await tx.kitchenTicket.findMany({
                    where: { orderId, status: { not: 'new' } },
                    select: { id: true },
                  })
                ).map((ticket) => ticket.id),
              );
              const unstarted = lines.filter(
                (line) => !line.ticketId || !started.has(line.ticketId),
              );
              if (unstarted.length > 0) await deductStock(tx, order, unstarted, by, at);
            }
          }
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
              commissionRate: tender.method === CASH ? '0' : (rates.get(tender.method) ?? '0'),
              commission:
                tender.method === CASH
                  ? '0'
                  : commissionOf(tender.amount, rates.get(tender.method) ?? '0'),
              takenById: auth.sub,
              shiftId: shift.id,
              createdAt: at,
            })),
          });
          // The customer spends and earns points, in the same transaction (spec 022, rules 3-6).
          const earned = await loyaltyOnPay(tx, order, by, at);
          const closed = await tx.order.update({
            where: { id: orderId },
            // The table is free again; the order keeps its name (spec 023, rule 7).
            data: {
              status: 'paid',
              paidAt: at,
              paidById: auth.sub,
              pointsEarned: earned,
              tableOpenKey: null,
            },
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

    // Gives money back for a paid order, in cash or by the way it was paid, with a manager's
    // approval, counted in the shift. See docs/specs/011-refunds.md.
    async refund(
      ctx: ActorContext,
      orderId: string,
      input: RefundRequest,
      meta: RequestMeta,
    ): Promise<Order> {
      const { auth, db } = ctx;
      const order = await load(db, orderId);

      // The same refund sent again gives back nothing twice (rule 7).
      const repeated = async () => {
        const existing = await db.refund.findUnique({ where: { id: input.id } });
        if (!existing) return null;
        if (existing.orderId !== orderId) {
          throw errors.conflict('REFUND_ID_TAKEN', 'This refund id is already used');
        }
        return describe(db, await load(db, orderId));
      };
      const before = await repeated();
      if (before) return before;

      const notPaid = () => errors.conflict('ORDER_NOT_PAID', 'Only a paid order can be refunded');
      const tooMuch = () => errors.validation([{ path: 'amount', message: 'REFUND_TOO_MUCH' }]);
      if (order.status !== 'paid') throw notPaid();
      if (toMils(input.amount) > mils(order.total) - mils(order.refunded)) throw tooMuch();

      // Money goes back the way it came, or in cash (rule 3).
      const payments = await db.payment.findMany({ where: { orderId } });
      const paidWith = payments.find((payment) => payment.method === input.method);
      if (input.method !== CASH && !paidWith) {
        throw errors.validation([{ path: 'method', message: 'REFUND_METHOD_INVALID' }]);
      }
      const methodName = (
        input.method === CASH ? CASH_NAME : (paidWith?.methodName ?? {})
      ) as Prisma.InputJsonObject;

      const approvedById = await approvals.authorize(
        ctx,
        order,
        'orders:refund',
        input.approval,
        meta,
      );

      try {
        const result = await db.$transaction(async (tx) => {
          // Raising the version locks the row (spec 005, rule 11); then the checks again.
          const locked = await tx.order.update({
            where: { id: orderId },
            data: { version: { increment: 1 } },
          });
          if (locked.status !== 'paid') throw notPaid();
          const refunded = mils(locked.refunded) + toMils(input.amount);
          if (refunded > mils(locked.total)) throw tooMuch();

          const shift = await tx.shift.findFirst({
            where: { branchId: order.branchId, openedById: auth.sub, status: 'open' },
            select: { id: true },
          });
          if (!shift) throw errors.conflict('SHIFT_REQUIRED', 'Open a shift before refunding');

          await tx.refund.create({
            data: {
              id: input.id,
              orderId,
              brandId: order.brandId,
              branchId: order.branchId,
              shiftId: shift.id,
              amount: input.amount,
              method: input.method,
              methodName,
              reason: input.reason,
              // Given back at the rate kept on the payment of that way (spec 025, rule 3).
              commission:
                input.method === CASH || !paidWith
                  ? '0'
                  : commissionOf(input.amount, paidWith.commissionRate.toFixed(2)),
              refundedById: auth.sub,
              approvedById,
              createdAt: now(),
            },
          });
          const updated = await tx.order.update({
            where: { id: orderId },
            data: { refunded: fromMils(refunded) },
          });
          return describe(tx, updated);
        });

        await audit(
          {
            action: 'order.refunded',
            userId: auth.sub,
            brandId: order.brandId,
            branchId: order.branchId,
            entityType: 'order',
            entityId: orderId,
            metadata: {
              number: order.number,
              amount: input.amount,
              method: input.method,
              reason: input.reason,
              refunded: result.refunded,
              approvedById,
            },
          },
          meta,
        );
        return result;
      } catch (error) {
        if (isUniqueViolation(error)) {
          const after = await repeated();
          if (after) return after;
          throw errors.conflict('REFUND_ID_TAKEN', 'This refund id is already used');
        }
        throw error;
      }
    },
  };
}

export type OrdersService = ReturnType<typeof createOrdersService>;
