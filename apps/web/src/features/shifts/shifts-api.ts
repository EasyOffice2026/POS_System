import {
  type CloseShiftRequest,
  type OpenShiftRequest,
  pageSchema,
  shiftReportSchema,
  type ShiftStatus,
  shiftSummarySchema,
} from '@pos/shared';
import { z } from 'zod';
import { request } from '../../lib/api';
import { queryString } from '../../lib/query-string';

export const shiftKeys = {
  all: ['shifts'] as const,
  current: (branchId: string) => ['shifts', 'current', branchId] as const,
  list: (branchId: string, status?: ShiftStatus) => ['shifts', 'list', branchId, status] as const,
  one: (id: string) => ['shifts', id] as const,
};

export const openShift = (body: OpenShiftRequest) =>
  request('/shifts', { method: 'POST', body, schema: shiftSummarySchema });

// The person's open shift at the branch, or null.
export const currentShift = (branchId: string) =>
  request(`/shifts/current${queryString({ branchId })}`, {
    schema: z.union([shiftSummarySchema, z.null()]),
  });

export const listShifts = (branchId: string, status?: ShiftStatus) =>
  request(`/shifts${queryString({ branchId, status, limit: 50 })}`, {
    schema: pageSchema(shiftSummarySchema),
  });

export const getShift = (id: string) => request(`/shifts/${id}`, { schema: shiftReportSchema });

export const closeShift = (id: string, body: CloseShiftRequest) =>
  request(`/shifts/${id}/close`, { method: 'POST', body, schema: shiftReportSchema });
