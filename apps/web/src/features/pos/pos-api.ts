import {
  type addOrderLineRequestSchema,
  type Approval,
  type DiscountKind,
  type OrderType,
  orderSchema,
  orderSummarySchema,
  pageSchema,
  type payOrderRequestSchema,
  type refundRequestSchema,
} from '@pos/shared';
import type { z } from 'zod';
import { request } from '../../lib/api';
import { queryString } from '../../lib/query-string';

// A line as the terminal sends it, before the server fills in the defaults.
export type AddLineInput = z.input<typeof addOrderLineRequestSchema>;
export type RefundRequestInput = Omit<z.input<typeof refundRequestSchema>, 'approval'>;

export const orderKeys = {
  all: ['orders'] as const,
  open: (branchId: string, status: 'open' | 'paid' = 'open') =>
    ['orders', status, branchId] as const,
  order: (id: string) => ['orders', id] as const,
};

const asOrder = { schema: orderSchema };
const withApproval = (approval: Approval | undefined) => (approval ? { approval } : {});

// The orders of the branch with a status, newest first: the open ones to pick up again, the paid
// ones to refund (spec 011).
export const listOrders = (branchId: string, status: 'open' | 'paid') =>
  request(`/orders${queryString({ branchId, status, limit: '50' })}`, {
    schema: pageSchema(orderSummarySchema),
  });

export const getOrder = (id: string) => request(`/orders/${id}`, asOrder);

export const createOrder = (body: { id: string; branchId: string; type: OrderType }) =>
  request('/orders', { method: 'POST', body, ...asOrder });

export const changeOrderType = (id: string, type: OrderType) =>
  request(`/orders/${id}`, { method: 'PATCH', body: { type }, ...asOrder });

export const addLine = (orderId: string, body: AddLineInput) =>
  request(`/orders/${orderId}/lines`, { method: 'POST', body, ...asOrder });

export const changeQuantity = (orderId: string, lineId: string, quantity: number) =>
  request(`/orders/${orderId}/lines/${lineId}`, {
    method: 'PATCH',
    body: { quantity },
    ...asOrder,
  });

export const removeLine = (orderId: string, lineId: string) =>
  request(`/orders/${orderId}/lines/${lineId}`, { method: 'DELETE', ...asOrder });

export const sendOrder = (orderId: string) =>
  request(`/orders/${orderId}/send`, { method: 'POST', ...asOrder });

export const voidLine = (orderId: string, lineId: string, reason: string, approval?: Approval) =>
  request(`/orders/${orderId}/lines/${lineId}/void`, {
    method: 'POST',
    body: { reason, ...withApproval(approval) },
    ...asOrder,
  });

export const voidOrder = (orderId: string, reason: string, approval?: Approval) =>
  request(`/orders/${orderId}/void`, {
    method: 'POST',
    body: { reason, ...withApproval(approval) },
    ...asOrder,
  });

export interface DiscountInput {
  kind: DiscountKind;
  value: string;
  reason: string;
}

export const setDiscount = (orderId: string, input: DiscountInput, approval?: Approval) =>
  request(`/orders/${orderId}/discount`, {
    method: 'PUT',
    body: { ...input, ...withApproval(approval) },
    ...asOrder,
  });

export const removeDiscount = (orderId: string, approval?: Approval) =>
  request(`/orders/${orderId}/discount`, {
    method: 'DELETE',
    body: withApproval(approval),
    ...asOrder,
  });

// The whole payment at once. The ids are made by the dialog, so sending it again takes nothing
// twice (spec 007, rule 7).
export type TenderInput = z.input<typeof payOrderRequestSchema>['tenders'][number];

export const payOrder = (orderId: string, tenders: TenderInput[]) =>
  request(`/orders/${orderId}/pay`, { method: 'POST', body: { tenders }, ...asOrder });

// Money back for a paid order, with a manager's approval when the person has no right to it.
export const refundOrder = (orderId: string, body: RefundRequestInput, approval?: Approval) =>
  request(`/orders/${orderId}/refunds`, {
    method: 'POST',
    body: { ...body, ...withApproval(approval) },
    ...asOrder,
  });
