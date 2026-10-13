import { kitchenTicketQuerySchema, moveTicketRequestSchema } from '@pos/shared';
import { Router } from 'express';
import { z } from 'zod';
import { parseWith } from '../../lib/validate';
import { requestContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import type { KitchenService } from './kitchen.service';

const ticketParams = z.object({ id: z.uuid() });

// The kitchen display, through the scoped client: a kitchen sees only the tickets of its own
// branches. See docs/specs/008-kitchen-display.md.
export function createKitchenRouter({ service }: { service: KitchenService }): Router {
  const router = Router();

  router.get('/tickets', requirePermission('orders:read'), async (req, res) => {
    const query = parseWith(kitchenTicketQuerySchema, req.query);
    res.json({ data: await service.list(requestContext(req), query) });
  });

  router.patch('/tickets/:id', requirePermission('kitchen:write'), async (req, res) => {
    const { id } = parseWith(ticketParams, req.params);
    const input = parseWith(moveTicketRequestSchema, req.body);
    res.json(await service.move(requestContext(req), id, input));
  });

  return router;
}
