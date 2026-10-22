import type {
  Approval,
  DeliveryDetails,
  Order,
  OrderLine,
  OrderTable,
  OrderType,
} from '@pos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { moveTicket } from '../kitchen/kitchen-api';
import { problemsFrom } from '../../lib/error-messages';
import { menuKeys } from '../menu/menu-api';
import { settingsKeys } from '../settings/settings-api';
import { shiftKeys } from '../shifts/shifts-api';
import { tableKeys } from '../tables/tables-api';
import {
  type AddLineInput,
  addLine,
  changeOrderType,
  changeQuantity,
  createOrder,
  type DiscountInput,
  getOrder,
  orderKeys,
  payOrder,
  printBill,
  refundOrder,
  type RefundRequestInput,
  removeDiscount,
  removeOrderCustomer,
  removeOrderPoints,
  removeOrderTable,
  removePromoCode,
  removeLine,
  sendOrder,
  setDiscount,
  setDelivery,
  setOrderCustomer,
  setOrderPoints,
  setOrderTable,
  setPromoCode,
  voidLine,
  voidOrder,
} from './pos-api';
import { menuIsStale, needsApproval, type Problem, problemOf } from './pos-errors';

// A change that may need a manager: it is sent without approval first, and again with the
// manager's staff code and PIN when the API asks for them (spec 005, rule 8).
export type ApprovedChange = (approval?: Approval) => Promise<Order>;

interface PendingApproval {
  change: ApprovedChange;
  after: ((order: Order) => void) | undefined;
}

export interface Notice {
  kind: 'error' | 'info';
  code: Problem | 'orderVoided' | 'refunded';
  number?: number;
  amount?: string;
}

// The order on the screen of one terminal, and every change to it. Each answer of the API is
// the whole order, which replaces what the screen shows. See docs/specs/006-pos-terminal.md.
export function useTerminalOrder(
  branchId: string,
  brandId: string,
  // The order types the branch offers, in the till's order (spec 026).
  offered: readonly OrderType[] = ['dine_in', 'takeaway'],
) {
  const queryClient = useQueryClient();
  const [orderId, setOrderId] = useState<string | null>(null);
  const [pickedType, setDraftType] = useState<OrderType>('takeaway');
  // A new order starts with the type picked, or the first one the branch offers.
  const draftType = offered.includes(pickedType) ? pickedType : (offered[0] ?? 'takeaway');
  // The phone and address typed for a delivery order not made yet (docs/specs/026-order-types.md).
  const [draftDelivery, setDraftDelivery] = useState<DeliveryDetails | null>(null);
  // The table picked for an order not made yet (docs/specs/023-floor-plan.md).
  const [draftTable, setDraftTable] = useState<OrderTable | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [approval, setApproval] = useState<PendingApproval | null>(null);

  const query = useQuery({
    queryKey: orderKeys.order(orderId ?? ''),
    queryFn: () => getOrder(orderId ?? ''),
    enabled: Boolean(orderId),
    // An open order is asked for again now and then, to show what the kitchen has made (spec 008,
    // rule 8).
    refetchInterval: (current) => (current.state.data?.status === 'open' ? 10_000 : false),
  });
  const order = orderId ? (query.data ?? null) : null;

  function show(next: Order) {
    queryClient.setQueryData(orderKeys.order(next.id), next);
    setOrderId(next.id);
    void queryClient.invalidateQueries({ queryKey: orderKeys.open(branchId) });
    void queryClient.invalidateQueries({ queryKey: tableKeys.floor(branchId) });
  }

  function fail(error: unknown) {
    const code = problemOf(error);
    setNotice({ kind: 'error', code });
    // The menu on the screen is out of date, or the order was changed elsewhere.
    if (menuIsStale(code)) {
      void queryClient.invalidateQueries({ queryKey: menuKeys.branchMenu(branchId) });
    }
    // A way to pay was switched off in the settings since the terminal loaded them.
    if (code === 'PAYMENT_METHOD_INVALID' || code === 'LOYALTY_OFF') {
      void queryClient.invalidateQueries({ queryKey: settingsKeys.brand(brandId) });
    }
    // The shift was closed elsewhere: the gate asks for a new one.
    // Another terminal sat an order at the table first.
    // The branch switched this type off since the terminal loaded its menu.
    if (code === 'ORDER_TYPE_NOT_OFFERED') {
      void queryClient.invalidateQueries({ queryKey: menuKeys.branchMenu(branchId) });
    }
    if (code === 'TABLE_TAKEN' || code === 'TABLE_NOT_FOUND') {
      void queryClient.invalidateQueries({ queryKey: tableKeys.floor(branchId) });
    }
    if (code === 'SHIFT_REQUIRED') {
      void queryClient.invalidateQueries({ queryKey: shiftKeys.current(branchId) });
    }
    const changedElsewhere = [
      'ORDER_NOT_OPEN',
      'LINE_VOIDED',
      'PAYMENT_TOTAL_MISMATCH',
      // The customer's points went on another order first.
      'POINTS_NOT_ENOUGH',
    ];
    if (changedElsewhere.includes(code) && orderId) {
      void queryClient.invalidateQueries({ queryKey: orderKeys.order(orderId) });
    }
  }

  async function perform(change: () => Promise<Order>): Promise<Order | null> {
    setBusy(true);
    setNotice(null);
    try {
      const next = await change();
      show(next);
      return next;
    } catch (error) {
      fail(error);
      return null;
    } finally {
      setBusy(false);
    }
  }

  // Sends a change that may need a manager. When it does, the approval dialog takes over.
  async function performApproved(change: ApprovedChange, after?: (order: Order) => void) {
    setBusy(true);
    setNotice(null);
    try {
      const next = await change();
      show(next);
      after?.(next);
    } catch (error) {
      if (needsApproval(error)) setApproval({ change, after });
      else fail(error);
    } finally {
      setBusy(false);
    }
  }

  // A change typed in a dialog: its problem is shown in the dialog, not on the screen. Answers
  // the code of the problem, or null when the change was made.
  async function boxed(
    change: (orderId: string) => Promise<Order>,
    field: string,
  ): Promise<string | null> {
    if (!order) return null;
    setBusy(true);
    setNotice(null);
    try {
      show(await change(order.id));
      return null;
    } catch (error) {
      const found = problemsFrom(error);
      return found.fields[field] ?? Object.values(found.fields)[0] ?? found.form ?? 'saveError';
    } finally {
      setBusy(false);
    }
  }

  // The order is made with its first dish, with an id made here, so a repeat adds nothing twice.
  async function add(input: AddLineInput): Promise<boolean> {
    const result = await perform(async () => {
      const id = order?.status === 'open' ? order.id : null;
      const target =
        id ??
        (
          await createOrder({
            id: crypto.randomUUID(),
            branchId,
            type: draftTable ? 'dine_in' : draftType,
            ...(draftTable ? { tableId: draftTable.id } : {}),
            ...(!draftTable && draftType === 'delivery' && draftDelivery
              ? { delivery: draftDelivery }
              : {}),
          })
        ).id;
      if (!id) {
        setOrderId(target);
        setDraftTable(null);
        setDraftDelivery(null);
      }
      return addLine(target, { ...input, id: crypto.randomUUID() });
    });
    return result !== null;
  }

  return {
    order,
    loading: Boolean(orderId) && query.isPending,
    type: order?.type ?? (draftTable ? 'dine_in' : draftType),
    // The order's table, or the one picked for the order about to be made.
    table: order ? order.table : draftTable,
    // The phone and address of a delivery order, or the ones typed before it exists.
    delivery: order ? order.delivery : draftDelivery,
    busy,
    notice,
    dismissNotice: () => setNotice(null),

    add,

    setType: (type: OrderType) => {
      if (!order) {
        setDraftType(type);
        if (type !== 'dine_in') setDraftTable(null);
        if (type !== 'delivery') setDraftDelivery(null);
      } else if (order.status === 'open') void perform(() => changeOrderType(order.id, type));
    },

    setQuantity: (line: OrderLine, quantity: number) => {
      if (!order) return;
      void perform(() =>
        quantity < 1 ? removeLine(order.id, line.id) : changeQuantity(order.id, line.id, quantity),
      );
    },

    send: (): Promise<Order | null> =>
      order ? perform(() => sendOrder(order.id)) : Promise.resolve(null),

    voidLine: (line: OrderLine, reason: string) => {
      if (order) void performApproved((given) => voidLine(order.id, line.id, reason, given));
    },

    voidOrder: (reason: string) => {
      if (!order) return;
      void performApproved(
        (given) => voidOrder(order.id, reason, given),
        (voided) => {
          setOrderId(null);
          setNotice({ kind: 'info', code: 'orderVoided', number: voided.number });
        },
      );
    },

    setDiscount: (input: DiscountInput) => {
      if (order) void performApproved((given) => setDiscount(order.id, input, given));
    },

    removeDiscount: () => {
      if (order) void performApproved((given) => removeDiscount(order.id, given));
    },

    // Types a promotion code; answers the problem to show in the code's box, or null when it
    // was taken (docs/specs/021-promotions.md, rule 5).
    applyPromoCode: (code: string) => boxed((id) => setPromoCode(id, code), 'code'),

    removePromoCode: () => {
      if (order) void perform(() => removePromoCode(order.id));
    },

    // Puts a customer on the order by phone, adding them when the phone is new; answers the
    // problem to show in the box, or null when it was done (docs/specs/022-loyalty.md, rule 2).
    applyCustomer: (input: { phone: string; name?: string }) =>
      boxed((id) => setOrderCustomer(id, input), 'phone'),

    // Types the phone and address of a delivery order. Before the order exists they wait for its
    // first dish; answers the problem to show in the box, or null when it was done.
    applyDelivery: async (details: DeliveryDetails): Promise<string | null> => {
      if (!order) {
        setDraftDelivery(details);
        return null;
      }
      return boxed((id) => setDelivery(id, details), 'phone');
    },

    removeCustomer: () => {
      if (order) void perform(() => removeOrderCustomer(order.id));
    },

    // Spends points on the order (rule 4), the same way.
    applyPoints: (points: number) => boxed((id) => setOrderPoints(id, points), 'points'),

    removePoints: () => {
      if (order) void perform(() => removeOrderPoints(order.id));
    },

    // Answers the paid order, for the receipt, or null when it failed.
    // Money back for a paid order, with a manager when the person has no right to it (spec 011).
    refund: (input: RefundRequestInput) => {
      if (!order) return;
      void performApproved(
        (given) => refundOrder(order.id, input, given),
        (next) =>
          setNotice({ kind: 'info', code: 'refunded', number: next.number, amount: input.amount }),
      );
    },

    pay: (tenders: Parameters<typeof payOrder>[1]) =>
      order ? perform(() => payOrder(order.id, tenders)) : Promise.resolve(null),

    // The food of a ready ticket was handed over (spec 009, rule 7). The order is read again,
    // so every line of that ticket shows it.
    markDone: (line: OrderLine) => {
      if (!order || !line.ticketId) return;
      const { ticketId } = line;
      void perform(async () => {
        await moveTicket(ticketId, 'ready', 'done');
        return getOrder(order.id);
      });
    },

    newOrder: () => {
      setOrderId(null);
      setDraftTable(null);
      setNotice(null);
    },

    open: (id: string) => {
      setOrderId(id);
      setDraftTable(null);
      setNotice(null);
    },

    // A new dine-in order at a free table: it is made with its first dish.
    startAt: (table: OrderTable) => {
      setOrderId(null);
      setDraftTable(table);
      setNotice(null);
    },

    // Puts the open order at a table, or moves it; before the order exists, picks the table.
    chooseTable: (table: OrderTable) => {
      if (order?.status === 'open') void perform(() => setOrderTable(order.id, table.id));
      else if (!order) setDraftTable(table);
    },

    removeTable: () => {
      if (order?.status === 'open') void perform(() => removeOrderTable(order.id));
      else if (!order) setDraftTable(null);
    },

    // Records that the bill was printed; answers the order to print, or null when it failed.
    printBill: () => (order ? perform(() => printBill(order.id)) : Promise.resolve(null)),

    // The approval dialog asks for a manager, sends the change again, and closes.
    approval: approval?.change ?? null,
    approvalDone: (next: Order) => {
      setApproval(null);
      show(next);
      approval?.after?.(next);
    },
    approvalCancelled: () => {
      setApproval(null);
    },
    approvalFailed: (error: unknown) => {
      setApproval(null);
      fail(error);
    },
  };
}

export type TerminalOrder = ReturnType<typeof useTerminalOrder>;
