import { updateBranchRequestSchema } from '@pos/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requestMeta } from '../../lib/request-meta';
import { parseWith } from '../../lib/validate';
import { requestContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import type { BrandsService } from './brands.service';

const idParamsSchema = z.object({ id: z.uuid() });

// One branch with its configuration. A branch is created under its brand, at
// POST /brands/:id/branches, and listed at GET /brands/:id/branches.
export function createBranchesRouter({ service }: { service: BrandsService }): Router {
  const router = Router();

  router.get('/:id', requirePermission('branches:read'), async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    res.json(await service.getBranch(requestContext(req), id));
  });

  router.patch('/:id', requirePermission('branches:write'), async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    const input = parseWith(updateBranchRequestSchema, req.body);
    res.json(await service.updateBranch(requestContext(req), id, input, requestMeta(req)));
  });

  return router;
}
