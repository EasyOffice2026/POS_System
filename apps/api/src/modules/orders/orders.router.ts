import {
  addOrderLineRequestSchema,
  createOrderRequestSchema,
  orderListQuerySchema,
  removeDiscountRequestSchema,
  setDiscountRequestSchema,
  updateOrderLineRequestSchema,
  updateOrderRequestSchema,
  voidRequestSchema,
} from '@pos/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requestMeta } from '../../lib/request-meta';
import { parseWith } from '../../lib/validate';
import { requestContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import type { OrdersService } from './orders.service';

const orderParams = z.object({ id: z.uuid() });
const lineParams = z.object({ id: z.uuid(), lineId: z.uuid() });

// Orders at a branch, through the scoped client: a person reaches only the orders of their own
// brand and branches. Every change answers with the whole order. See docs/specs/005-orders.md.
export function createOrdersRouter({ service }: { service: OrdersService }): Router {
  const router = Router();
  const read = requirePermission('orders:read');
  const write = requirePermission('orders:write');

  router.get('/', read, async (req, res) => {
    const query = parseWith(orderListQuerySchema, req.query);
    res.json(await service.list(requestContext(req), query));
  });

  router.post('/', write, async (req, res) => {
    const input = parseWith(createOrderRequestSchema, req.body);
    const { order, created } = await service.create(requestContext(req), input);
    res.status(created ? 201 : 200).json(order);
  });

  router.get('/:id', read, async (req, res) => {
    const { id } = parseWith(orderParams, req.params);
    res.json(await service.get(requestContext(req), id));
  });

  router.patch('/:id', write, async (req, res) => {
    const { id } = parseWith(orderParams, req.params);
    const input = parseWith(updateOrderRequestSchema, req.body);
    res.json(await service.update(requestContext(req), id, input));
  });

  router.post('/:id/lines', write, async (req, res) => {
    const { id } = parseWith(orderParams, req.params);
    const input = parseWith(addOrderLineRequestSchema, req.body);
    res.json(await service.addLine(requestContext(req), id, input));
  });

  router.patch('/:id/lines/:lineId', write, async (req, res) => {
    const { id, lineId } = parseWith(lineParams, req.params);
    const input = parseWith(updateOrderLineRequestSchema, req.body);
    res.json(await service.updateLine(requestContext(req), id, lineId, input));
  });

  router.delete('/:id/lines/:lineId', write, async (req, res) => {
    const { id, lineId } = parseWith(lineParams, req.params);
    res.json(await service.removeLine(requestContext(req), id, lineId));
  });

  router.post('/:id/send', write, async (req, res) => {
    const { id } = parseWith(orderParams, req.params);
    res.json(await service.send(requestContext(req), id));
  });

  router.post('/:id/lines/:lineId/void', write, async (req, res) => {
    const { id, lineId } = parseWith(lineParams, req.params);
    const input = parseWith(voidRequestSchema, req.body);
    res.json(await service.voidLine(requestContext(req), id, lineId, input, requestMeta(req)));
  });

  router.post('/:id/void', write, async (req, res) => {
    const { id } = parseWith(orderParams, req.params);
    const input = parseWith(voidRequestSchema, req.body);
    res.json(await service.voidOrder(requestContext(req), id, input, requestMeta(req)));
  });

  router.put('/:id/discount', write, async (req, res) => {
    const { id } = parseWith(orderParams, req.params);
    const input = parseWith(setDiscountRequestSchema, req.body);
    res.json(await service.setDiscount(requestContext(req), id, input, requestMeta(req)));
  });

  router.delete('/:id/discount', write, async (req, res) => {
    const { id } = parseWith(orderParams, req.params);
    const input = parseWith(removeDiscountRequestSchema, req.body ?? {});
    res.json(await service.removeDiscount(requestContext(req), id, input, requestMeta(req)));
  });

  return router;
}
