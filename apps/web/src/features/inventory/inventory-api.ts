import {
  branchStockSchema,
  type CreateIngredientRequest,
  type CreateMovementRequest,
  ingredientSchema,
  pageSchema,
  stockMovementSchema,
  type UpdateIngredientRequest,
} from '@pos/shared';
import { z } from 'zod';
import { request } from '../../lib/api';
import { queryString } from '../../lib/query-string';

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
