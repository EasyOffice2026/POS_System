import {
  cancelPurchaseOrderRequestSchema,
  createPurchaseOrderRequestSchema,
  purchaseOrderListQuerySchema,
  updatePurchaseOrderRequestSchema,
  createSupplierRequestSchema,
  putSupplierPricesRequestSchema,
  supplierListQuerySchema,
  updateSupplierRequestSchema,
  cancelCountRequestSchema,
  countListQuerySchema,
  saveCountLinesRequestSchema,
  startCountRequestSchema,
  createIngredientRequestSchema,
  createMovementRequestSchema,
  cancelTransferRequestSchema,
  createTransferRequestSchema,
  ingredientListQuerySchema,
  movementListQuerySchema,
  setLowLevelRequestSchema,
  stockAlertsQuerySchema,
  stockListQuerySchema,
  transferDestinationsQuerySchema,
  transferListQuerySchema,
  updateIngredientRequestSchema,
} from '@pos/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requestMeta } from '../../lib/request-meta';
import { parseWith } from '../../lib/validate';
import { requestContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import type { CountsService } from './counts.service';
import type { InventoryService } from './inventory.service';
import type { PurchaseOrdersService } from './purchase-orders.service';
import type { SuppliersService } from './suppliers.service';
import type { TransfersService } from './transfers.service';

const idParams = z.object({ id: z.uuid() });
const stockParams = z.object({ branchId: z.uuid(), ingredientId: z.uuid() });

// Ingredients and stock, through the scoped client: a person reaches their own brand's
// ingredients and the stock of their own branches. See docs/specs/012-ingredients-and-stock.md.
export function createInventoryRouter({
  service,
  transfers,
  counts,
  suppliers,
  purchaseOrders,
}: {
  service: InventoryService;
  transfers: TransfersService;
  counts: CountsService;
  suppliers: SuppliersService;
  purchaseOrders: PurchaseOrdersService;
}): Router {
  const router = Router();
  const read = requirePermission('inventory:read');
  const write = requirePermission('inventory:write');

  router.get('/ingredients', read, async (req, res) => {
    const query = parseWith(ingredientListQuerySchema, req.query);
    res.json(await service.listIngredients(requestContext(req), query));
  });

  router.post('/ingredients', requirePermission('ingredients:write'), async (req, res) => {
    const input = parseWith(createIngredientRequestSchema, req.body);
    res
      .status(201)
      .json(await service.createIngredient(requestContext(req), input, requestMeta(req)));
  });

  router.patch('/ingredients/:id', requirePermission('ingredients:write'), async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    const input = parseWith(updateIngredientRequestSchema, req.body);
    res.json(await service.updateIngredient(requestContext(req), id, input, requestMeta(req)));
  });

  router.get('/stock', read, async (req, res) => {
    const query = parseWith(stockListQuerySchema, req.query);
    res.json({ data: await service.listStock(requestContext(req), query) });
  });

  // What is out or low at each branch the person sees (docs/specs/016-stock-alerts.md).
  router.get('/alerts', read, async (req, res) => {
    const query = parseWith(stockAlertsQuerySchema, req.query);
    res.json({ data: await service.alerts(requestContext(req), query) });
  });

  router.put('/stock/:branchId/:ingredientId/level', write, async (req, res) => {
    const { branchId, ingredientId } = parseWith(stockParams, req.params);
    const input = parseWith(setLowLevelRequestSchema, req.body);
    res.json(await service.setLowLevel(requestContext(req), branchId, ingredientId, input));
  });

  router.post('/movements', write, async (req, res) => {
    const input = parseWith(createMovementRequestSchema, req.body);
    res.json(await service.recordMovement(requestContext(req), input));
  });

  router.get('/movements', read, async (req, res) => {
    const query = parseWith(movementListQuerySchema, req.query);
    res.json(await service.listMovements(requestContext(req), query));
  });

  // Transfers between branches (docs/specs/014-stock-transfers.md).
  router.get('/transfers', read, async (req, res) => {
    const query = parseWith(transferListQuerySchema, req.query);
    res.json(await transfers.list(requestContext(req), query));
  });

  router.get('/transfers/destinations', write, async (req, res) => {
    const { branchId } = parseWith(transferDestinationsQuerySchema, req.query);
    res.json({ data: await transfers.destinations(requestContext(req), branchId) });
  });

  router.get('/transfers/:id', read, async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    res.json(await transfers.get(requestContext(req), id));
  });

  router.post('/transfers', write, async (req, res) => {
    const input = parseWith(createTransferRequestSchema, req.body);
    res.status(201).json(await transfers.send(requestContext(req), input, requestMeta(req)));
  });

  router.post('/transfers/:id/receive', write, async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    res.json(await transfers.receive(requestContext(req), id, requestMeta(req)));
  });

  router.post('/transfers/:id/cancel', write, async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    const input = parseWith(cancelTransferRequestSchema, req.body);
    res.json(await transfers.cancel(requestContext(req), id, input, requestMeta(req)));
  });

  // Stock counts (docs/specs/015-stock-counts.md).
  router.get('/counts', read, async (req, res) => {
    const query = parseWith(countListQuerySchema, req.query);
    res.json(await counts.list(requestContext(req), query));
  });

  router.get('/counts/:id', read, async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    res.json(await counts.get(requestContext(req), id));
  });

  router.post('/counts', write, async (req, res) => {
    const input = parseWith(startCountRequestSchema, req.body);
    res.status(201).json(await counts.start(requestContext(req), input, requestMeta(req)));
  });

  router.put('/counts/:id/lines', write, async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    const input = parseWith(saveCountLinesRequestSchema, req.body);
    res.json(await counts.saveLines(requestContext(req), id, input));
  });

  router.post('/counts/:id/finish', write, async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    res.json(await counts.finish(requestContext(req), id, requestMeta(req)));
  });

  router.post('/counts/:id/cancel', write, async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    const input = parseWith(cancelCountRequestSchema, req.body);
    res.json(await counts.cancel(requestContext(req), id, input, requestMeta(req)));
  });

  // Suppliers and their prices (docs/specs/017-suppliers.md).
  const writeSuppliers = requirePermission('suppliers:write');

  router.get('/suppliers', read, async (req, res) => {
    const query = parseWith(supplierListQuerySchema, req.query);
    res.json(await suppliers.list(requestContext(req), query));
  });

  router.get('/suppliers/:id', read, async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    res.json(await suppliers.get(requestContext(req), id));
  });

  router.post('/suppliers', writeSuppliers, async (req, res) => {
    const input = parseWith(createSupplierRequestSchema, req.body);
    res.status(201).json(await suppliers.create(requestContext(req), input, requestMeta(req)));
  });

  router.patch('/suppliers/:id', writeSuppliers, async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    const input = parseWith(updateSupplierRequestSchema, req.body);
    res.json(await suppliers.update(requestContext(req), id, input, requestMeta(req)));
  });

  router.put('/suppliers/:id/prices', writeSuppliers, async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    const input = parseWith(putSupplierPricesRequestSchema, req.body);
    res.json(await suppliers.putPrices(requestContext(req), id, input, requestMeta(req)));
  });

  // Purchase orders (docs/specs/018-purchase-orders.md).
  router.get('/purchase-orders', read, async (req, res) => {
    const query = parseWith(purchaseOrderListQuerySchema, req.query);
    res.json(await purchaseOrders.list(requestContext(req), query));
  });

  router.get('/purchase-orders/:id', read, async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    res.json(await purchaseOrders.get(requestContext(req), id));
  });

  router.post('/purchase-orders', write, async (req, res) => {
    const input = parseWith(createPurchaseOrderRequestSchema, req.body);
    res.status(201).json(await purchaseOrders.create(requestContext(req), input, requestMeta(req)));
  });

  router.put('/purchase-orders/:id', write, async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    const input = parseWith(updatePurchaseOrderRequestSchema, req.body);
    res.json(await purchaseOrders.update(requestContext(req), id, input, requestMeta(req)));
  });

  router.post('/purchase-orders/:id/send', write, async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    res.json(await purchaseOrders.send(requestContext(req), id, requestMeta(req)));
  });

  router.post('/purchase-orders/:id/cancel', write, async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    const input = parseWith(cancelPurchaseOrderRequestSchema, req.body);
    res.json(await purchaseOrders.cancel(requestContext(req), id, input, requestMeta(req)));
  });

  return router;
}
