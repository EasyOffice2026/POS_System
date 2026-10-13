import {
  createIngredientRequestSchema,
  createMovementRequestSchema,
  ingredientListQuerySchema,
  movementListQuerySchema,
  setLowLevelRequestSchema,
  stockListQuerySchema,
  updateIngredientRequestSchema,
} from '@pos/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requestMeta } from '../../lib/request-meta';
import { parseWith } from '../../lib/validate';
import { requestContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import type { InventoryService } from './inventory.service';

const idParams = z.object({ id: z.uuid() });
const stockParams = z.object({ branchId: z.uuid(), ingredientId: z.uuid() });

// Ingredients and stock, through the scoped client: a person reaches their own brand's
// ingredients and the stock of their own branches. See docs/specs/012-ingredients-and-stock.md.
export function createInventoryRouter({ service }: { service: InventoryService }): Router {
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

  return router;
}
