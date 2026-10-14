import { salesReportSchema } from '@pos/shared';
import { request } from '../../lib/api';
import { queryString } from '../../lib/query-string';

// The sales report of a period (docs/specs/020-sales-reports.md).
export interface SalesReportFilter {
  from: string;
  to: string;
  brandId?: string;
  branchId?: string;
}

export const reportKeys = {
  sales: (filter: SalesReportFilter) => ['reports', 'sales', filter] as const,
};

export const getSalesReport = (filter: SalesReportFilter) =>
  request(`/reports/sales${queryString({ ...filter })}`, { schema: salesReportSchema });
