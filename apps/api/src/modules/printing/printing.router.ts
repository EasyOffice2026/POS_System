import { createPrintJobRequestSchema } from '@pos/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requestMeta } from '../../lib/request-meta';
import { parseWith } from '../../lib/validate';
import { requestContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import type { PrintingService } from './printing.service';

const idParams = z.object({ id: z.uuid() });

// What a till leaves for the print bridge of its branch, through the scoped client: a cashier
// reaches only the printers and jobs of their own branch. See docs/specs/028-print-bridge.md.
export function createPrintJobsRouter({ service }: { service: PrintingService }): Router {
  const router = Router();

  router.post('/', requirePermission('orders:write'), async (req, res) => {
    const input = parseWith(createPrintJobRequestSchema, req.body);
    res.status(201).json(await service.create(requestContext(req), input));
  });

  router.get('/:id', requirePermission('orders:read'), async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    res.json(await service.get(requestContext(req), id));
  });

  return router;
}

// The key of a branch's bridge, made by whoever may change the branch (rule 4).
export function createBridgeKeysRouter({ service }: { service: PrintingService }): Router {
  const router = Router();

  router.get('/:id/print-bridge-key', requirePermission('branches:write'), async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    res.json(await service.keyInfo(requestContext(req), id));
  });

  router.post('/:id/print-bridge-key', requirePermission('branches:write'), async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    res.status(201).json(await service.createKey(requestContext(req), id, requestMeta(req)));
  });

  return router;
}
