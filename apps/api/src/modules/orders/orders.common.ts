import {
  CURRENCY,
  localizedTextSchema,
  type Order,
  orderComboChoiceSchema,
  type OrderLine,
  orderModifierSchema,
  type OrderSummary,
  percentOfMils,
  toMils,
} from '@pos/shared';
import { z } from 'zod';
import {
  type OrderLine as LineRow,
  type Order as OrderRow,
  Prisma,
} from '../../generated/prisma/client';
import type { ScopedClient } from '../../tenancy/scoped-client';

// What a change to an order reads and writes, whether through the client or a transaction.
export type OrderTx = Pick<ScopedClient, 'order' | 'orderLine' | 'branch' | 'brand'>;

export const mils = (value: Prisma.Decimal): number => toMils(value.toFixed(3));
const iso = (value: Date | null) => (value ? value.toISOString() : null);

// The day on the clock of a time zone, as YYYY-MM-DD.
export function businessDateOn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

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

export function toOrderLine(row: LineRow): OrderLine {
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  } as const;
}

export function toOrder(row: OrderRow, lines: LineRow[]): Order {
  return { ...orderFields(row), lines: lines.map(toOrderLine) };
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
