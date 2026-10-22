import {
  type addOrderLineRequestSchema,
  type Approval,
  type Customer,
  customerSchema,
  type DeliveryDetails,
  type DiscountKind,
  type OrderType,
  orderSchema,
  orderSummarySchema,
  pageSchema,
  type payOrderRequestSchema,
  type refundRequestSchema,
} from '@pos/shared';
import type { z } from 'zod';
import { ApiError, request } from '../../lib/api';
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

export const createOrder = (body: {
  id: string;
  branchId: string;
  type: OrderType;
  tableId?: string;
  delivery?: DeliveryDetails;
}) => request('/orders', { method: 'POST', body, ...asOrder });

export const changeOrderType = (id: string, type: OrderType) =>
  request(`/orders/${id}`, { method: 'PATCH', body: { type }, ...asOrder });

// The phone and address of a delivery order (spec 026).
export const setDelivery = (id: string, delivery: DeliveryDetails) =>
  request(`/orders/${id}`, { method: 'PATCH', body: { delivery }, ...asOrder });

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

// A promotion code on the order (docs/specs/021-promotions.md).
export const setPromoCode = (orderId: string, code: string) =>
  request(`/orders/${orderId}/promo-code`, { method: 'PUT', body: { code }, ...asOrder });

export const removePromoCode = (orderId: string) =>
  request(`/orders/${orderId}/promo-code`, { method: 'DELETE', ...asOrder });

// The table of a dine-in order, and its bill (docs/specs/023-floor-plan.md).
export const setOrderTable = (orderId: string, tableId: string) =>
  request(`/orders/${orderId}/table`, { method: 'PUT', body: { tableId }, ...asOrder });

export const removeOrderTable = (orderId: string) =>
  request(`/orders/${orderId}/table`, { method: 'DELETE', ...asOrder });

export const printBill = (orderId: string) =>
  request(`/orders/${orderId}/bill`, { method: 'POST', ...asOrder });

// A customer on the order, and the points they spend on it (docs/specs/022-loyalty.md).
export const findCustomer = async (phone: string): Promise<Customer | null> => {
  try {
    return await request(`/customers/lookup${queryString({ phone })}`, { schema: customerSchema });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
};

export const setOrderCustomer = (orderId: string, body: { phone: string; name?: string }) =>
  request(`/orders/${orderId}/customer`, { method: 'PUT', body, ...asOrder });

export const removeOrderCustomer = (orderId: string) =>
  request(`/orders/${orderId}/customer`, { method: 'DELETE', ...asOrder });

export const setOrderPoints = (orderId: string, points: number) =>
  request(`/orders/${orderId}/points`, { method: 'PUT', body: { points }, ...asOrder });

export const removeOrderPoints = (orderId: string) =>
  request(`/orders/${orderId}/points`, { method: 'DELETE', ...asOrder });
