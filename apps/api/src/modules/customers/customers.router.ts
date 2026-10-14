import {
  adjustPointsRequestSchema,
  customerListQuerySchema,
  customerLookupQuerySchema,
  updateCustomerRequestSchema,
} from '@pos/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requestMeta } from '../../lib/request-meta';
import { parseWith } from '../../lib/validate';
import { requestContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import type { CustomersService } from './customers.service';

const idParams = z.object({ id: z.uuid() });

// Customers, through the scoped client: a person reaches their own brand's customers.
// See docs/specs/022-loyalty.md.
export function createCustomersRouter({ service }: { service: CustomersService }): Router {
  const router = Router();
  const read = requirePermission('customers:read');
  const write = requirePermission('customers:write');

  router.get('/', read, async (req, res) => {
    const query = parseWith(customerListQuerySchema, req.query);
    res.json(await service.list(requestContext(req), query));
  });

  // The POS finds a customer by phone with the right to take orders.
  router.get('/lookup', requirePermission('orders:write'), async (req, res) => {
    const { phone } = parseWith(customerLookupQuerySchema, req.query);
    res.json(await service.lookup(requestContext(req), phone));
  });

  router.get('/:id', read, async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    res.json(await service.get(requestContext(req), id));
  });

  router.patch('/:id', write, async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    const input = parseWith(updateCustomerRequestSchema, req.body);
    res.json(await service.update(requestContext(req), id, input, requestMeta(req)));
  });

  router.post('/:id/points', write, async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    const input = parseWith(adjustPointsRequestSchema, req.body);
    res.json(await service.adjustPoints(requestContext(req), id, input, requestMeta(req)));
  });

  return router;
}
