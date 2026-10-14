import {
  addOrderLineRequestSchema,
  createOrderRequestSchema,
  orderListQuerySchema,
  payOrderRequestSchema,
  putOrderCustomerRequestSchema,
  putOrderTableRequestSchema,
  putOrderPointsRequestSchema,
  putPromoCodeRequestSchema,
  refundRequestSchema,
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

  // The table of a dine-in order, and its bill (docs/specs/023-floor-plan.md).
  router.put('/:id/table', write, async (req, res) => {
    const { id } = parseWith(orderParams, req.params);
    const { tableId } = parseWith(putOrderTableRequestSchema, req.body);
    res.json(await service.setTable(requestContext(req), id, tableId));
  });
  router.delete('/:id/table', write, async (req, res) => {
    const { id } = parseWith(orderParams, req.params);
    res.json(await service.removeTable(requestContext(req), id));
  });
  router.post('/:id/bill', write, async (req, res) => {
    const { id } = parseWith(orderParams, req.params);
    res.json(await service.printBill(requestContext(req), id));
  });

  // The customer and their points on the order (docs/specs/022-loyalty.md).
  router.put('/:id/customer', write, async (req, res) => {
    const { id } = parseWith(orderParams, req.params);
    const input = parseWith(putOrderCustomerRequestSchema, req.body);
    res.json(await service.setCustomer(requestContext(req), id, input, requestMeta(req)));
  });

  router.delete('/:id/customer', write, async (req, res) => {
    const { id } = parseWith(orderParams, req.params);
    res.json(await service.removeCustomer(requestContext(req), id));
  });

  router.put('/:id/points', write, async (req, res) => {
    const { id } = parseWith(orderParams, req.params);
    const { points } = parseWith(putOrderPointsRequestSchema, req.body);
    res.json(await service.setPoints(requestContext(req), id, points));
  });

  router.delete('/:id/points', write, async (req, res) => {
    const { id } = parseWith(orderParams, req.params);
    res.json(await service.removePoints(requestContext(req), id));
  });

  // A promotion code on the order (docs/specs/021-promotions.md).
  router.put('/:id/promo-code', write, async (req, res) => {
    const { id } = parseWith(orderParams, req.params);
    const { code } = parseWith(putPromoCodeRequestSchema, req.body);
    res.json(await service.setPromoCode(requestContext(req), id, code));
  });

  router.delete('/:id/promo-code', write, async (req, res) => {
    const { id } = parseWith(orderParams, req.params);
    res.json(await service.removePromoCode(requestContext(req), id));
  });

  router.post('/:id/refunds', write, async (req, res) => {
    const { id } = parseWith(orderParams, req.params);
    const input = parseWith(refundRequestSchema, req.body);
    res.json(await service.refund(requestContext(req), id, input, requestMeta(req)));
  });

  router.post('/:id/pay', write, async (req, res) => {
    const { id } = parseWith(orderParams, req.params);
    const input = parseWith(payOrderRequestSchema, req.body);
    res.json(await service.pay(requestContext(req), id, input));
  });

  return router;
}
