import {
  branchStockSchema,
  type CreateIngredientRequest,
  type CreateMovementRequest,
  type createTransferRequestSchema,
  type startCountRequestSchema,
  stockCountSchema,
  stockCountSummarySchema,
  ingredientSchema,
  localizedTextSchema,
  pageSchema,
  stockMovementSchema,
  stockTransferSchema,
  type UpdateIngredientRequest,
} from '@pos/shared';
import { z } from 'zod';
import { request } from '../../lib/api';
import { queryString } from '../../lib/query-string';

// The request before the server applies defaults.
export type CreateTransferInput = z.input<typeof createTransferRequestSchema>;
export type StartCountInput = z.input<typeof startCountRequestSchema>;

export const inventoryKeys = {
  all: ['inventory'] as const,
  ingredients: (brandId: string, q = '') => ['inventory', brandId, 'ingredients', q] as const,
  stock: (branchId: string) => ['inventory', 'stock', branchId] as const,
  movements: (branchId: string, ingredientId = '') =>
    ['inventory', 'movements', branchId, ingredientId] as const,
};

export async function listIngredients(brandId: string, q = '') {
  const { data } = await request(`/inventory/ingredients${queryString({ brandId, q })}`, {
    schema: pageSchema(ingredientSchema),
  });
  return data;
}

export const createIngredient = (body: CreateIngredientRequest & { brandId: string }) =>
  request('/inventory/ingredients', { method: 'POST', body, schema: ingredientSchema });

export const updateIngredient = (id: string, body: UpdateIngredientRequest) =>
  request(`/inventory/ingredients/${id}`, { method: 'PATCH', body, schema: ingredientSchema });

export async function listStock(branchId: string) {
  const { data } = await request(`/inventory/stock${queryString({ branchId })}`, {
    schema: z.object({ data: z.array(branchStockSchema) }),
  });
  return data;
}

export const setLowLevel = (branchId: string, ingredientId: string, lowLevel: string | null) =>
  request(`/inventory/stock/${branchId}/${ingredientId}/level`, {
    method: 'PUT',
    body: { lowLevel },
    schema: branchStockSchema,
  });

export const recordMovement = (body: CreateMovementRequest) =>
  request('/inventory/movements', { method: 'POST', body, schema: branchStockSchema });

export async function listMovements(branchId: string, ingredientId = '') {
  const { data } = await request(
    `/inventory/movements${queryString({ branchId, ingredientId, limit: 100 })}`,
    { schema: pageSchema(stockMovementSchema) },
  );
  return data;
}

// ---- transfers between branches (docs/specs/014-stock-transfers.md)

export const transferKeys = {
  list: (branchId: string) => ['inventory', 'transfers', branchId] as const,
  one: (id: string) => ['inventory', 'transfer', id] as const,
  destinations: (branchId: string) => ['inventory', 'transfer-destinations', branchId] as const,
};

export async function listTransfers(branchId: string) {
  const { data } = await request(`/inventory/transfers${queryString({ branchId, limit: 100 })}`, {
    schema: pageSchema(stockTransferSchema),
  });
  return data;
}

export const getTransfer = (id: string) =>
  request(`/inventory/transfers/${id}`, { schema: stockTransferSchema });

const destinationSchema = z.object({ id: z.uuid(), name: localizedTextSchema });
export type TransferDestination = z.infer<typeof destinationSchema>;

export async function listDestinations(branchId: string) {
  const { data } = await request(`/inventory/transfers/destinations${queryString({ branchId })}`, {
    schema: z.object({ data: z.array(destinationSchema) }),
  });
  return data;
}

export const sendTransfer = (body: CreateTransferInput) =>
  request('/inventory/transfers', { method: 'POST', body, schema: stockTransferSchema });

export const receiveTransfer = (id: string) =>
  request(`/inventory/transfers/${id}/receive`, {
    method: 'POST',
    body: {},
    schema: stockTransferSchema,
  });

export const cancelTransfer = (id: string, reason: string) =>
  request(`/inventory/transfers/${id}/cancel`, {
    method: 'POST',
    body: { reason },
    schema: stockTransferSchema,
  });

// ---- stock counts (docs/specs/015-stock-counts.md)

export const countKeys = {
  list: (branchId: string) => ['inventory', 'counts', branchId] as const,
  one: (id: string) => ['inventory', 'count', id] as const,
};

export async function listCounts(branchId: string) {
  const { data } = await request(`/inventory/counts${queryString({ branchId, limit: 100 })}`, {
    schema: pageSchema(stockCountSummarySchema),
  });
  return data;
}

export const getCount = (id: string) =>
  request(`/inventory/counts/${id}`, { schema: stockCountSchema });

export const startCount = (body: StartCountInput) =>
  request('/inventory/counts', { method: 'POST', body, schema: stockCountSchema });

export const saveCountLines = (
  id: string,
  lines: { ingredientId: string; counted: string | null }[],
) =>
  request(`/inventory/counts/${id}/lines`, {
    method: 'PUT',
    body: { lines },
    schema: stockCountSchema,
  });

export const finishCount = (id: string) =>
  request(`/inventory/counts/${id}/finish`, {
    method: 'POST',
    body: {},
    schema: stockCountSchema,
  });

export const cancelCount = (id: string, reason: string) =>
  request(`/inventory/counts/${id}/cancel`, {
    method: 'POST',
    body: { reason },
    schema: stockCountSchema,
  });
