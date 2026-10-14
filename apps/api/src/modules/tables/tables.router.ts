import { putTablesRequestSchema } from '@pos/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requestMeta } from '../../lib/request-meta';
import { parseWith } from '../../lib/validate';
import { requestContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import type { TablesService } from './tables.service';

const branchParams = z.object({ id: z.uuid() });

// The tables of a branch, under /branches/:id. See docs/specs/023-floor-plan.md.
export function createTablesRouter({ service }: { service: TablesService }): Router {
  const router = Router();

  router.get('/:id/tables', requirePermission('branches:read'), async (req, res) => {
    const { id } = parseWith(branchParams, req.params);
    res.json({ data: await service.list(requestContext(req), id) });
  });

  router.put('/:id/tables', requirePermission('tables:write'), async (req, res) => {
    const { id } = parseWith(branchParams, req.params);
    const input = parseWith(putTablesRequestSchema, req.body);
    res.json({ data: await service.save(requestContext(req), id, input, requestMeta(req)) });
  });

  // The POS sees the tables with their orders.
  router.get('/:id/floor', requirePermission('orders:read'), async (req, res) => {
    const { id } = parseWith(branchParams, req.params);
    res.json({ data: await service.floor(requestContext(req), id) });
  });

  return router;
}
