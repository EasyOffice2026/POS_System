import {
  closeShiftRequestSchema,
  currentShiftQuerySchema,
  openShiftRequestSchema,
  shiftListQuerySchema,
} from '@pos/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requestMeta } from '../../lib/request-meta';
import { parseWith } from '../../lib/validate';
import { requestContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import type { ShiftsService } from './shifts.service';

const idParams = z.object({ id: z.uuid() });

// Shifts, through the scoped client: a person reaches the shifts of their own branches only.
// See docs/specs/010-shifts.md.
export function createShiftsRouter({ service }: { service: ShiftsService }): Router {
  const router = Router();
  const takesPayments = requirePermission('orders:write');

  router.post('/', takesPayments, async (req, res) => {
    const input = parseWith(openShiftRequestSchema, req.body);
    res.status(201).json(await service.open(requestContext(req), input, requestMeta(req)));
  });

  router.get('/current', takesPayments, async (req, res) => {
    const { branchId } = parseWith(currentShiftQuerySchema, req.query);
    res.json(await service.current(requestContext(req), branchId));
  });

  router.get('/', requirePermission('shifts:read'), async (req, res) => {
    const query = parseWith(shiftListQuerySchema, req.query);
    res.json(await service.list(requestContext(req), query));
  });

  // A person's own shift, or any with shifts:read; the service decides.
  router.get('/:id', requirePermission('orders:read'), async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    res.json(await service.get(requestContext(req), id));
  });

  router.post('/:id/close', takesPayments, async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    const input = parseWith(closeShiftRequestSchema, req.body);
    res.json(await service.close(requestContext(req), id, input, requestMeta(req)));
  });

  return router;
}
