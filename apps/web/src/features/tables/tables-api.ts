import { diningTableListSchema, floorSchema, type PutTablesRequest } from '@pos/shared';
import { request } from '../../lib/api';

// The tables of a branch and its floor plan (docs/specs/023-floor-plan.md).
export const tableKeys = {
  all: ['tables'] as const,
  plan: (branchId: string) => ['tables', 'plan', branchId] as const,
  floor: (branchId: string) => ['tables', 'floor', branchId] as const,
};

export async function listTables(branchId: string) {
  return (await request(`/branches/${branchId}/tables`, { schema: diningTableListSchema })).data;
}

export async function saveTables(branchId: string, body: PutTablesRequest) {
  return (
    await request(`/branches/${branchId}/tables`, {
      method: 'PUT',
      body,
      schema: diningTableListSchema,
    })
  ).data;
}

// The tables in use with their open orders, for the POS.
export async function getFloor(branchId: string) {
  return (await request(`/branches/${branchId}/floor`, { schema: floorSchema })).data;
}
