import type { Order, OrderLine, OrderSummary } from '@pos/shared';
import { ids } from './fixtures';
import { itemIds } from './menu-fixtures';

export const orderIds = {
  first: '01990000-0000-7000-8000-000000000701',
  second: '01990000-0000-7000-8000-000000000702',
};

export const lineIds = {
  cola: '01990000-0000-7000-8000-000000000801',
  margherita: '01990000-0000-7000-8000-000000000802',
};

export function orderLine(overrides: Partial<OrderLine> = {}): OrderLine {
  return {
    id: lineIds.cola,
    kind: 'item',
    itemId: itemIds.cola,
    comboId: null,
    name: { en: 'Cola', ar: 'كولا' },
    unitPrice: '5.000',
    quantity: 1,
    lineTotal: '5.000',
    modifiers: [],
    choices: [],
    note: null,
    status: 'pending',
    kitchenStatus: null,
    ticketId: null,
    sentAt: null,
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

// An open takeaway order at Pizza Mall. The totals are given, not worked out.
export function order(overrides: Partial<Order> = {}): Order {
  return {
    id: orderIds.first,
    brandId: ids.pizza,
    branchId: ids.pizzaMall,
    businessDate: '2026-10-13',
    number: 1,
    type: 'takeaway',
    status: 'open',
    note: null,
    currency: 'KWD',
    subtotal: '0.000',
    discount: null,
    total: '0.000',
    openedById: '01990000-0000-7000-8000-000000000107',
    voidedAt: null,
    voidReason: null,
    paidAt: null,
    paidById: null,
    createdAt: '2026-10-13T09:00:00.000Z',
    updatedAt: '2026-10-13T09:00:00.000Z',
    lines: [],
    payments: [],
    change: '0.000',
    refunds: [],
    refunded: '0.000',
    ...overrides,
  };
}

export function orderSummary(overrides: Partial<Order> = {}): OrderSummary {
  const { lines, payments: _payments, change: _change, ...rest } = order(overrides);
  return { ...rest, lineCount: lines.length };
}
