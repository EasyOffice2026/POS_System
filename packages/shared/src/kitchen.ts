import { z } from 'zod';
import { localizedTextSchema } from './localized';
import {
  orderComboChoiceSchema,
  orderModifierSchema,
  orderTypeSchema,
  type TicketStatus,
  ticketStatusSchema,
} from './orders';

// The kitchen display: one ticket per "send" of an order, moved from new to done by the cook.
// See docs/specs/008-kitchen-display.md.

// How many finished tickets the kitchen sees, to recall one finished by mistake.
export const DONE_TICKETS_SHOWN = 10;

// The moves a ticket can make (rule 2): forward, skipping "preparing" if need be, and back from
// done to ready.
const moves: Record<TicketStatus, readonly TicketStatus[]> = {
  new: ['preparing', 'ready'],
  preparing: ['ready'],
  ready: ['done'],
  done: ['ready'],
};

export const canMoveTicket = (from: TicketStatus, to: TicketStatus) => moves[from].includes(to);

// The usual next step, for the one big button on a ticket.
export const nextTicketStatus: Record<TicketStatus, TicketStatus> = {
  new: 'preparing',
  preparing: 'ready',
  ready: 'done',
  done: 'ready',
};

export const kitchenTicketLineSchema = z.object({
  id: z.uuid(),
  name: localizedTextSchema,
  quantity: z.number().int(),
  modifiers: z.array(orderModifierSchema),
  choices: z.array(orderComboChoiceSchema),
  note: z.string().nullable(),
  // Voided after it was sent: the cook stops making it (rule 5).
  voided: z.boolean(),
});
export type KitchenTicketLine = z.infer<typeof kitchenTicketLineSchema>;

export const kitchenTicketSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  orderNumber: z.number().int(),
  orderType: orderTypeSchema,
  orderNote: z.string().nullable(),
  // The kitchen station it is for, or null when the brand has none (docs/specs/009-settings.md).
  stationId: z.uuid().nullable(),
  status: ticketStatusSchema,
  sentAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  readyAt: z.iso.datetime().nullable(),
  doneAt: z.iso.datetime().nullable(),
  lines: z.array(kitchenTicketLineSchema),
});
export type KitchenTicket = z.infer<typeof kitchenTicketSchema>;

export const kitchenTicketListSchema = z.object({ data: z.array(kitchenTicketSchema) });

export const kitchenTicketQuerySchema = z.object({
  branchId: z.uuid({ error: 'BRANCH_REQUIRED' }),
  // One station's tickets only. Left out, every ticket of the branch.
  stationId: z.uuid().optional(),
});
export type KitchenTicketQuery = z.infer<typeof kitchenTicketQuerySchema>;

// The status the screen saw, so a ticket moved by another screen first is not moved twice (rule 3).
export const moveTicketRequestSchema = z
  .strictObject({ from: ticketStatusSchema, to: ticketStatusSchema })
  .refine((move) => canMoveTicket(move.from, move.to), {
    path: ['to'],
    message: 'TICKET_STATUS_INVALID',
  });
export type MoveTicketRequest = z.infer<typeof moveTicketRequestSchema>;
