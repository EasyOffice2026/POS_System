import {
  DONE_TICKETS_SHOWN,
  type KitchenTicket,
  type KitchenTicketQuery,
  type MoveTicketRequest,
  type TicketStatus,
} from '@pos/shared';
import type { KitchenTicket as TicketRow, Prisma } from '../../generated/prisma/client';
import { errors } from '../../lib/http-errors';
import type { ActorContext } from '../../middleware/authenticate';
import type { ScopedClient } from '../../tenancy/scoped-client';
import { toOrderLine } from '../orders/orders.common';

export interface KitchenDeps {
  now: () => Date;
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
export function createKitchenService({ now }: KitchenDeps) {
  // The tickets with their order and their lines, in the order given.
  async function describe(db: ScopedClient, rows: TicketRow[]): Promise<KitchenTicket[]> {
    if (rows.length === 0) return [];
    const ticketIds = rows.map((row) => row.id);
    const orders = await db.order.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.orderId))] } },
      select: { id: true, number: true, type: true, note: true, status: true },
    });
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

      const open = await db.kitchenTicket.findMany({
        where: { branchId: branch.id, status: { in: ['new', 'preparing', 'ready'] } },
        orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
        take: 200,
      });
      const done = await db.kitchenTicket.findMany({
        where: { branchId: branch.id, status: 'done' },
        orderBy: [{ doneAt: 'desc' }, { id: 'desc' }],
        take: DONE_TICKETS_SHOWN,
      });
      return describe(db, [...open, ...done]);
    },

    // Moves a ticket from the status the screen saw. If another screen moved it first, nothing
    // changes and the screen is told (rule 3).
    async move({ db }: ActorContext, id: string, input: MoveTicketRequest): Promise<KitchenTicket> {
      const moved = await db.kitchenTicket.updateMany({
        where: { id, status: input.from },
        data: { status: input.to, ...timesOf(input.to, now()) },
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
