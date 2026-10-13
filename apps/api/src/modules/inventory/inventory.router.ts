import {
  createIngredientRequestSchema,
  createMovementRequestSchema,
  cancelTransferRequestSchema,
  createTransferRequestSchema,
  ingredientListQuerySchema,
  movementListQuerySchema,
  setLowLevelRequestSchema,
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
import type { InventoryService } from './inventory.service';
import type { TransfersService } from './transfers.service';

const idParams = z.object({ id: z.uuid() });
const stockParams = z.object({ branchId: z.uuid(), ingredientId: z.uuid() });

// Ingredients and stock, through the scoped client: a person reaches their own brand's
// ingredients and the stock of their own branches. See docs/specs/012-ingredients-and-stock.md.
export function createInventoryRouter({
  service,
  transfers,
}: {
  service: InventoryService;
  transfers: TransfersService;
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

  return router;
}
