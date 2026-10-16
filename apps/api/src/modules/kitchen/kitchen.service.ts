import {
  DONE_TICKETS_SHOWN,
  type KitchenTicket,
  type KitchenTicketQuery,
  type MoveTicketRequest,
  parseBrandSettings,
  type TicketStatus,
} from '@pos/shared';
import type { KitchenTicket as TicketRow, Prisma } from '../../generated/prisma/client';
import { errors } from '../../lib/http-errors';
import type { PrismaClient } from '../../lib/prisma';
import type { ActorContext } from '../../middleware/authenticate';
import type { ScopedClient } from '../../tenancy/scoped-client';
import { toOrderLine } from '../orders/orders.common';

export interface KitchenDeps {
  now: () => Date;
  prisma: PrismaClient;
  // Takes the ingredients of a ticket's dishes off the branch's stock, for brands that do it when
  // the kitchen starts (spec 013; docs/client-decisions.md).
  deductStock: (
    tx: Pick<ScopedClient, 'recipeLine' | 'branchStock' | 'stockMovement'>,
    order: { id: string; number: number; brandId: string; branchId: string },
    lines: { itemId: string | null; quantity: number; status: string; details: unknown }[],
    by: { id: string; name: string | null },
    at: Date,
  ) => Promise<void>;
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

// The times a move writes: when the ticket was started, ready or done. A recall from done takes
// the time it was done away (rule 2).
function timesOf(to: TicketStatus, at: Date): Prisma.KitchenTicketUpdateManyMutationInput {
  switch (to) {
    case 'preparing':
      return { startedAt: at };
    case 'ready':
      return { readyAt: at, doneAt: null };
    case 'done':
      return { doneAt: at };
    case 'new':
      return {};
  }
}

// The kitchen display of a branch. See docs/specs/008-kitchen-display.md.
export function createKitchenService({ now, prisma, deductStock }: KitchenDeps) {
  // The tickets with their order and their lines, in the order given.
  async function describe(db: ScopedClient, rows: TicketRow[]): Promise<KitchenTicket[]> {
    if (rows.length === 0) return [];
    const ticketIds = rows.map((row) => row.id);
    const orders = await db.order.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.orderId))] } },
      select: { id: true, number: true, type: true, note: true, status: true, tableId: true },
    });
    const tableIds = [
      ...new Set(orders.flatMap((order) => (order.tableId ? [order.tableId] : []))),
    ];
    const tables =
      tableIds.length === 0
        ? []
        : await db.diningTable.findMany({
            where: { id: { in: tableIds } },
            select: { id: true, name: true },
          });
    const tableName = new Map(tables.map((table) => [table.id, table.name]));
    const lines = await db.orderLine.findMany({
      where: { ticketId: { in: ticketIds } },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    const orderOf = new Map(orders.map((order) => [order.id, order]));

    return rows.flatMap((row) => {
      const order = orderOf.get(row.orderId);
      if (!order) return [];
      return [
        {
          id: row.id,
          orderId: row.orderId,
          orderNumber: order.number,
          orderType: order.type,
          orderNote: order.note,
          tableName: order.tableId ? (tableName.get(order.tableId) ?? null) : null,
          stationId: row.stationId,
          status: row.status,
          sentAt: row.sentAt.toISOString(),
          startedAt: iso(row.startedAt),
          readyAt: iso(row.readyAt),
          doneAt: iso(row.doneAt),
          lines: lines
            .filter((line) => line.ticketId === row.id)
            .map((line) => {
              const { id, name, quantity, modifiers, choices, note, status } = toOrderLine(line);
              // A line voided after it was sent, or an order voided as a whole (rule 5).
              const voided = status === 'voided' || order.status === 'voided';
              return { id, name, quantity, modifiers, choices, note, voided };
            }),
        },
      ];
    });
  }

  return {
    // What the kitchen works on, oldest first, then the last ones it finished (rule 4).
    async list({ db }: ActorContext, query: KitchenTicketQuery): Promise<KitchenTicket[]> {
      // A branch the person cannot see is answered like one that does not exist.
      const branch = await db.branch.findUnique({ where: { id: query.branchId } });
      if (!branch) throw errors.notFound('Branch');

      // One station's tickets, or every ticket of the branch (spec 009, rule 6).
      const station = query.stationId ? { stationId: query.stationId } : {};
      const open = await db.kitchenTicket.findMany({
        where: { branchId: branch.id, status: { in: ['new', 'preparing', 'ready'] }, ...station },
        orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
        take: 200,
      });
      const done = await db.kitchenTicket.findMany({
        where: { branchId: branch.id, status: 'done', ...station },
        orderBy: [{ doneAt: 'desc' }, { id: 'desc' }],
        take: DONE_TICKETS_SHOWN,
      });
      return describe(db, [...open, ...done]);
    },

    // Moves a ticket from the status the screen saw. If another screen moved it first, nothing
    // changes and the screen is told (rule 3).
    async move(
      { auth, db }: ActorContext,
      id: string,
      input: MoveTicketRequest,
    ): Promise<KitchenTicket> {
      const found = await db.kitchenTicket.findUnique({ where: { id } });
      if (!found) throw errors.notFound('Ticket');

      // The kitchen works tickets. A cashier may only mark one done, when the brand says the
      // cashier does that (spec 009, rule 7).
      if (!auth.permissions.includes('kitchen:write')) {
        const brand = await db.brand.findUnique({ where: { id: found.brandId } });
        const cashierMay =
          parseBrandSettings(brand?.settings).ticketDoneBy === 'cashier' &&
          input.to === 'done' &&
          auth.permissions.includes('orders:write');
        if (!cashierMay) throw errors.forbidden();
      }

      // A brand that takes stock off when the kitchen starts a dish does it as the ticket starts,
      // in the same transaction, so a ticket started on two screens at once takes it off once
      // (docs/client-decisions.md, "Stock deduction").
      const starts = input.from === 'new' && input.to === 'preparing';
      const deductsNow =
        starts &&
        parseBrandSettings((await db.brand.findUnique({ where: { id: found.brandId } }))?.settings)
          .stockDeductAt === 'preparing';
      // The name goes on the stock movements; it is read before the transaction, since the
      // database answers one request at a time while one is open.
      const by = deductsNow
        ? {
            id: auth.sub,
            name:
              (await prisma.user.findUnique({ where: { id: auth.sub }, select: { name: true } }))
                ?.name ?? null,
          }
        : null;
      const at = now();
      const moved = await db.$transaction(async (tx) => {
        const result = await tx.kitchenTicket.updateMany({
          where: { id, status: input.from },
          data: { status: input.to, ...timesOf(input.to, at) },
        });
        if (result.count === 1 && by) {
          const order = await tx.order.findUnique({ where: { id: found.orderId } });
          const lines = await tx.orderLine.findMany({ where: { ticketId: id } });
          if (order) await deductStock(tx, order, lines, by, at);
        }
        return result;
      });
      const row = await db.kitchenTicket.findUnique({ where: { id } });
      if (!row) throw errors.notFound('Ticket');
      if (moved.count === 0) {
        throw errors.conflict('TICKET_CHANGED', 'This ticket was moved on another screen');
      }
      const [ticket] = await describe(db, [row]);
      if (!ticket) throw errors.notFound('Ticket');
      return ticket;
    },
  };
}

export type KitchenService = ReturnType<typeof createKitchenService>;
