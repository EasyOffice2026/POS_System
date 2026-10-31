import type { createBranchRequestSchema, updateBranchRequestSchema } from '@pos/shared';
import { branchDetailSchema, printBridgeKeyInfoSchema, printBridgeKeySchema } from '@pos/shared';
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

// The key of the branch's print bridge (docs/specs/028-print-bridge.md, rule 4): when it was
// made, and a new one, shown once.
export const getBridgeKeyInfo = (id: string) =>
  request(`/branches/${id}/print-bridge-key`, { schema: printBridgeKeyInfoSchema });

export const createBridgeKey = (id: string) =>
  request(`/branches/${id}/print-bridge-key`, { method: 'POST', schema: printBridgeKeySchema });
