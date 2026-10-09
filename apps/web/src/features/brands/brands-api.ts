import type { createBrandRequestSchema } from '@pos/shared';
import { brandSchema, type UpdateBrandRequest } from '@pos/shared';
import type { z } from 'zod';
import { request } from '../../lib/api';

// The request before the server applies defaults, so callers can leave out fields that have one.
export type CreateBrandInput = z.input<typeof createBrandRequestSchema>;

export const getBrand = (id: string) => request(`/brands/${id}`, { schema: brandSchema });

export const createBrand = (body: CreateBrandInput) =>
  request('/brands', { method: 'POST', body, schema: brandSchema });

export const updateBrand = (id: string, body: UpdateBrandRequest) =>
  request(`/brands/${id}`, { method: 'PATCH', body, schema: brandSchema });
