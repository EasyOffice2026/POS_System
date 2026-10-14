import { overviewQuerySchema, salesReportQuerySchema } from '@pos/shared';
import { Router } from 'express';
import { parseWith } from '../../lib/validate';
import { requestContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import type { OverviewService } from './overview.service';
import type { ReportsService } from './reports.service';

// Reports, through the scoped client: a person reads the sales of their own branches only.
// See docs/specs/020-sales-reports.md.
export function createReportsRouter({
  service,
  overview,
}: {
  service: ReportsService;
  overview: OverviewService;
}): Router {
  const router = Router();

  router.get('/sales', requirePermission('reports:read'), async (req, res) => {
    const query = parseWith(salesReportQuerySchema, req.query);
    res.json(await service.sales(requestContext(req), query));
  });

  // Today's overview of the group, for the dashboard (docs/specs/024-group-dashboard.md).
  router.get('/overview', requirePermission('reports:read'), async (req, res) => {
    const query = parseWith(overviewQuerySchema, req.query);
    res.json(await overview.today(requestContext(req), query));
  });

  return router;
}
