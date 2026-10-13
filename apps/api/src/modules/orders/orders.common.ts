import {
  CURRENCY,
  localizedTextSchema,
  type Order,
  orderComboChoiceSchema,
  type OrderLine,
  orderModifierSchema,
  type OrderPayment,
  type OrderSummary,
  fromMils,
  percentOfMils,
  type TicketStatus,
  toMils,
} from '@pos/shared';
import { z } from 'zod';
import {
  type OrderLine as LineRow,
  type Order as OrderRow,
  type Payment as PaymentRow,
  Prisma,
} from '../../generated/prisma/client';
import type { ScopedClient } from '../../tenancy/scoped-client';

// What a change to an order reads and writes, whether through the client or a transaction.
export type OrderTx = Pick<
  ScopedClient,
  | 'order'
  | 'orderLine'
  | 'payment'
  | 'kitchenTicket'
  | 'branch'
  | 'brand'
  | 'menuItem'
  | 'menuCategory'
  | 'shift'
>;

export const mils = (value: Prisma.Decimal): number => toMils(value.toFixed(3));
const iso = (value: Date | null) => (value ? value.toISOString() : null);

// A date column holds midnight UTC of that day.
export const dbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

export const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

export const isNotFound = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';

const detailsSchema = z.object({
  modifiers: z.array(orderModifierSchema).default([]),
  choices: z.array(orderComboChoiceSchema).default([]),
});

// The status of the kitchen ticket of each sent line, by ticket id.
export type TicketStatuses = ReadonlyMap<string, TicketStatus>;

export function toOrderLine(row: LineRow, tickets: TicketStatuses = new Map()): OrderLine {
  const details = detailsSchema.parse(row.details);
  return {
    id: row.id,
    kind: row.kind,
    itemId: row.itemId,
    comboId: row.comboId,
    name: localizedTextSchema.parse(row.name),
    unitPrice: row.unitPrice.toFixed(3),
    quantity: row.quantity,
    lineTotal: row.lineTotal.toFixed(3),
    modifiers: details.modifiers,
    choices: details.choices,
    note: row.note,
    status: row.status,
    kitchenStatus: row.ticketId ? (tickets.get(row.ticketId) ?? null) : null,
    ticketId: row.ticketId,
    sentAt: iso(row.sentAt),
    voidedAt: iso(row.voidedAt),
    voidReason: row.voidReason,
  };
}

function orderFields(row: OrderRow) {
  return {
    id: row.id,
    brandId: row.brandId,
    branchId: row.branchId,
    businessDate: row.businessDate.toISOString().slice(0, 10),
    number: row.number,
    type: row.type,
    status: row.status,
    note: row.note,
    currency: CURRENCY,
    subtotal: row.subtotal.toFixed(3),
    discount:
      row.discountKind && row.discountValue
        ? {
            kind: row.discountKind,
            value: row.discountValue.toFixed(row.discountKind === 'percent' ? 2 : 3),
            amount: row.discountAmount.toFixed(3),
            reason: row.discountReason ?? '',
          }
        : null,
    total: row.total.toFixed(3),
    openedById: row.openedById,
    voidedAt: iso(row.voidedAt),
    voidReason: row.voidReason,
    paidAt: iso(row.paidAt),
    paidById: row.paidById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  } as const;
}

export function toPayment(row: PaymentRow): OrderPayment {
  return {
    id: row.id,
    method: row.method,
    methodName: localizedTextSchema.parse(row.methodName),
    amount: row.amount.toFixed(3),
    tendered: row.tendered?.toFixed(3) ?? null,
    change: row.change.toFixed(3),
    reference: row.reference,
    takenById: row.takenById,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toOrder(
  row: OrderRow,
  lines: LineRow[],
  payments: PaymentRow[] = [],
  tickets: TicketStatuses = new Map(),
): Order {
  return {
    ...orderFields(row),
    lines: lines.map((line) => toOrderLine(line, tickets)),
    payments: payments.map(toPayment),
    change: fromMils(payments.reduce((sum, payment) => sum + mils(payment.change), 0)),
  };
}

export function toSummary(row: OrderRow, lineCount: number): OrderSummary {
  return { ...orderFields(row), lineCount };
}

// The totals of an order from its lines: the subtotal of the lines that are not voided, the
// discount worked out again on it, and what is left. See docs/specs/005-orders.md, rules 9 and 10.
export function totalsOf(order: OrderRow, lines: LineRow[]) {
  const subtotal = lines
    .filter((line) => line.status !== 'voided')
    .reduce((sum, line) => sum + mils(line.lineTotal), 0);

  let discount = 0;
  if (order.discountKind === 'percent' && order.discountValue) {
    discount = percentOfMils(subtotal, order.discountValue.toFixed(2));
  } else if (order.discountKind === 'amount' && order.discountValue) {
    discount = Math.min(mils(order.discountValue), subtotal);
  }
  return { subtotal, discount, total: subtotal - discount };
}
