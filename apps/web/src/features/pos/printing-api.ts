import { type CreatePrintJobRequest, printJobSchema } from '@pos/shared';
import { request } from '../../lib/api';

// What a till leaves for the print bridge of its branch, and whether it printed
// (docs/specs/028-print-bridge.md).
export const createPrintJob = (body: CreatePrintJobRequest) =>
  request('/print-jobs', { method: 'POST', body, schema: printJobSchema });

export const getPrintJob = (id: string) => request(`/print-jobs/${id}`, { schema: printJobSchema });
