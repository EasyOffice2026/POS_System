import type { Approval, Order, OrderLine, OrderType } from '@pos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { moveTicket } from '../kitchen/kitchen-api';
import { problemsFrom } from '../../lib/error-messages';
import { menuKeys } from '../menu/menu-api';
import { settingsKeys } from '../settings/settings-api';
import { shiftKeys } from '../shifts/shifts-api';
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
  refundOrder,
  type RefundRequestInput,
  removeDiscount,
  removePromoCode,
  removeLine,
  sendOrder,
  setDiscount,
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
export function useTerminalOrder(branchId: string, brandId: string) {
  const queryClient = useQueryClient();
  const [orderId, setOrderId] = useState<string | null>(null);
  const [draftType, setDraftType] = useState<OrderType>('takeaway');
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
  }

  function fail(error: unknown) {
    const code = problemOf(error);
    setNotice({ kind: 'error', code });
    // The menu on the screen is out of date, or the order was changed elsewhere.
    if (menuIsStale(code)) {
      void queryClient.invalidateQueries({ queryKey: menuKeys.branchMenu(branchId) });
    }
    // A way to pay was switched off in the settings since the terminal loaded them.
    if (code === 'PAYMENT_METHOD_INVALID') {
      void queryClient.invalidateQueries({ queryKey: settingsKeys.brand(brandId) });
    }
    // The shift was closed elsewhere: the gate asks for a new one.
    if (code === 'SHIFT_REQUIRED') {
      void queryClient.invalidateQueries({ queryKey: shiftKeys.current(branchId) });
    }
    const changedElsewhere = ['ORDER_NOT_OPEN', 'LINE_VOIDED', 'PAYMENT_TOTAL_MISMATCH'];
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

  // The order is made with its first dish, with an id made here, so a repeat adds nothing twice.
  async function add(input: AddLineInput): Promise<boolean> {
    const result = await perform(async () => {
      const id = order?.status === 'open' ? order.id : null;
      const target =
        id ?? (await createOrder({ id: crypto.randomUUID(), branchId, type: draftType })).id;
      if (!id) setOrderId(target);
      return addLine(target, { ...input, id: crypto.randomUUID() });
    });
    return result !== null;
  }

  return {
    order,
    loading: Boolean(orderId) && query.isPending,
    type: order?.type ?? draftType,
    busy,
    notice,
    dismissNotice: () => setNotice(null),

    add,

    setType: (type: OrderType) => {
      if (!order) setDraftType(type);
      else if (order.status === 'open') void perform(() => changeOrderType(order.id, type));
    },

    setQuantity: (line: OrderLine, quantity: number) => {
      if (!order) return;
      void perform(() =>
        quantity < 1 ? removeLine(order.id, line.id) : changeQuantity(order.id, line.id, quantity),
      );
    },

    send: () => {
      if (order) void perform(() => sendOrder(order.id));
    },

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
    applyPromoCode: async (code: string): Promise<string | null> => {
      if (!order) return null;
      setBusy(true);
      setNotice(null);
      try {
        show(await setPromoCode(order.id, code));
        return null;
      } catch (error) {
        const found = problemsFrom(error);
        return found.fields.code ?? found.form ?? 'saveError';
      } finally {
        setBusy(false);
      }
    },

    removePromoCode: () => {
      if (order) void perform(() => removePromoCode(order.id));
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
      setNotice(null);
    },

    open: (id: string) => {
      setOrderId(id);
      setNotice(null);
    },

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
