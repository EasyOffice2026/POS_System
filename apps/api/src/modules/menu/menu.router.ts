import {
  branchMenuQuerySchema,
  categoryListQuerySchema,
  comboListQuerySchema,
  createCategoryRequestSchema,
  createComboRequestSchema,
  createItemRequestSchema,
  createModifierGroupRequestSchema,
  createModifierRequestSchema,
  itemListQuerySchema,
  putBranchOverrideRequestSchema,
  reorderCategoriesRequestSchema,
  updateCategoryRequestSchema,
  updateComboRequestSchema,
  updateItemRequestSchema,
  updateModifierGroupRequestSchema,
  updateModifierRequestSchema,
} from '@pos/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requestMeta } from '../../lib/request-meta';
import { parseWith } from '../../lib/validate';
import { requestContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import type { MenuService } from './menu.service';

const idParamsSchema = z.object({ id: z.uuid() });

// Every route works through the scoped client, so a manager only reaches the menu of their own
// brand (a group admin reaches every brand's). Reading needs menu:read and changing needs
// menu:write. Nothing is deleted: a thing that is no longer sold is made inactive.
export function createMenuRouter({ service }: { service: MenuService }): Router {
  const router = Router();
  const read = requirePermission('menu:read');
  const write = requirePermission('menu:write');

  // The menu of one branch, as its terminal loads it. It is answered from the cache when it can
  // be, and the answer has an ETag, so a terminal that asks again with it gets a short answer.
  router.get('/', read, async (req, res) => {
    const { branchId } = parseWith(branchMenuQuerySchema, req.query);
    const json = await service.branchMenu.load(requestContext(req), branchId);
    res.type('application/json').send(json);
  });

  // ---- categories

  router.get('/categories', read, async (req, res) => {
    const query = parseWith(categoryListQuerySchema, req.query);
    res.json({ data: await service.categories.list(requestContext(req), query) });
  });

  router.post('/categories', write, async (req, res) => {
    const input = parseWith(createCategoryRequestSchema, req.body);
    res
      .status(201)
      .json(await service.categories.create(requestContext(req), input, requestMeta(req)));
  });

  router.put('/categories/order', write, async (req, res) => {
    const input = parseWith(reorderCategoriesRequestSchema, req.body);
    res.json({
      data: await service.categories.reorder(requestContext(req), input, requestMeta(req)),
    });
  });

  router.patch('/categories/:id', write, async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    const input = parseWith(updateCategoryRequestSchema, req.body);
    res.json(await service.categories.update(requestContext(req), id, input, requestMeta(req)));
  });

  // ---- items

  router.get('/items', read, async (req, res) => {
    const query = parseWith(itemListQuerySchema, req.query);
    res.json(await service.items.list(requestContext(req), query));
  });

  router.post('/items', write, async (req, res) => {
    const input = parseWith(createItemRequestSchema, req.body);
    res.status(201).json(await service.items.create(requestContext(req), input, requestMeta(req)));
  });

  router.get('/items/:id', read, async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    res.json(await service.items.get(requestContext(req), id));
  });

  router.patch('/items/:id', write, async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    const input = parseWith(updateItemRequestSchema, req.body);
    res.json(await service.items.update(requestContext(req), id, input, requestMeta(req)));
  });

  router.get('/items/:id/branch-overrides', read, async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    res.json({ data: await service.items.listOverrides(requestContext(req), id) });
  });

  router.put('/items/:id/branch-override', write, async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    const input = parseWith(putBranchOverrideRequestSchema, req.body);
    res.json(await service.items.putOverride(requestContext(req), id, input, requestMeta(req)));
  });

  // ---- modifier groups and modifiers

  router.post('/items/:id/modifier-groups', write, async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    const input = parseWith(createModifierGroupRequestSchema, req.body);
    res
      .status(201)
      .json(await service.modifiers.createGroup(requestContext(req), id, input, requestMeta(req)));
  });

  router.patch('/modifier-groups/:id', write, async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    const input = parseWith(updateModifierGroupRequestSchema, req.body);
    res.json(await service.modifiers.updateGroup(requestContext(req), id, input, requestMeta(req)));
  });

  router.post('/modifier-groups/:id/modifiers', write, async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    const input = parseWith(createModifierRequestSchema, req.body);
    res
      .status(201)
      .json(
        await service.modifiers.createModifier(requestContext(req), id, input, requestMeta(req)),
      );
  });

  router.patch('/modifiers/:id', write, async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    const input = parseWith(updateModifierRequestSchema, req.body);
    res.json(
      await service.modifiers.updateModifier(requestContext(req), id, input, requestMeta(req)),
    );
  });

  // ---- combos

  router.get('/combos', read, async (req, res) => {
    const query = parseWith(comboListQuerySchema, req.query);
    res.json({ data: await service.combos.list(requestContext(req), query) });
  });

  router.post('/combos', write, async (req, res) => {
    const input = parseWith(createComboRequestSchema, req.body);
    res.status(201).json(await service.combos.create(requestContext(req), input, requestMeta(req)));
  });

  router.get('/combos/:id', read, async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    res.json(await service.combos.get(requestContext(req), id));
  });

  router.patch('/combos/:id', write, async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    const input = parseWith(updateComboRequestSchema, req.body);
    res.json(await service.combos.update(requestContext(req), id, input, requestMeta(req)));
  });

  return router;
}
