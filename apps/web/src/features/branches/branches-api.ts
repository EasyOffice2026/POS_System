import type { createBranchRequestSchema, updateBranchRequestSchema } from '@pos/shared';
import { branchDetailSchema } from '@pos/shared';
import type { z } from 'zod';
import { request } from '../../lib/api';

// The requests before the server applies defaults, so callers can leave out fields that have one.
export type CreateBranchInput = z.input<typeof createBranchRequestSchema>;
export type UpdateBranchInput = z.input<typeof updateBranchRequestSchema>;

// One branch with its configuration (opening hours and printers).
export const getBranch = (id: string) => request(`/branches/${id}`, { schema: branchDetailSchema });

export const createBranch = (brandId: string, body: CreateBranchInput) =>
  request(`/brands/${brandId}/branches`, { method: 'POST', body, schema: branchDetailSchema });

export const updateBranch = (id: string, body: UpdateBranchInput) =>
  request(`/branches/${id}`, { method: 'PATCH', body, schema: branchDetailSchema });
