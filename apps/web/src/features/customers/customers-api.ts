import {
  type AdjustPointsRequest,
  customerDetailSchema,
  customerSchema,
  pageSchema,
  type updateCustomerRequestSchema,
} from '@pos/shared';
import type { z } from 'zod';
import { request } from '../../lib/api';
import { queryString } from '../../lib/query-string';

// The customers of a brand and their points (docs/specs/022-loyalty.md).
export type UpdateCustomerInput = z.input<typeof updateCustomerRequestSchema>;

export const customerKeys = {
  all: ['customers'] as const,
  list: (brandId: string, q: string) => ['customers', 'list', brandId, q] as const,
  one: (id: string) => ['customers', id] as const,
};

export const listCustomers = (brandId: string, q: string, cursor?: string) =>
  request(`/customers${queryString({ brandId, q, cursor })}`, {
    schema: pageSchema(customerSchema),
  });

export const getCustomer = (id: string) =>
  request(`/customers/${id}`, { schema: customerDetailSchema });

export const updateCustomer = (id: string, body: UpdateCustomerInput) =>
  request(`/customers/${id}`, { method: 'PATCH', body, schema: customerDetailSchema });

export const adjustPoints = (id: string, body: AdjustPointsRequest) =>
  request(`/customers/${id}/points`, { method: 'POST', body, schema: customerDetailSchema });
