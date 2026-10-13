import {
  brandSettingsRequestSchema,
  createBranchRequestSchema,
  createBrandRequestSchema,
  cursorQuerySchema,
  updateBrandRequestSchema,
} from '@pos/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requestMeta } from '../../lib/request-meta';
import { parseWith } from '../../lib/validate';
import { requestContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import type { BrandsService } from './brands.service';

const idParamsSchema = z.object({ id: z.uuid() });

// Every route reads and writes through the scoped client, so each person only reaches their own
// brand (a group admin reaches every brand). See docs/specs/002-brands-and-branches.md.
export function createBrandsRouter({ service }: { service: BrandsService }): Router {
  const router = Router();

  router.get('/', requirePermission('brands:read'), async (req, res) => {
    const query = parseWith(cursorQuerySchema, req.query);
    res.json(await service.listBrands(requestContext(req), query));
  });

  router.post('/', requirePermission('brands:write'), async (req, res) => {
    const input = parseWith(createBrandRequestSchema, req.body);
    res.status(201).json(await service.createBrand(requestContext(req), input, requestMeta(req)));
  });

  router.get('/:id', requirePermission('brands:read'), async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    res.json(await service.getBrand(requestContext(req), id));
  });

  router.patch('/:id', requirePermission('brands:write'), async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    const input = parseWith(updateBrandRequestSchema, req.body);
    res.json(await service.updateBrand(requestContext(req), id, input, requestMeta(req)));
  });

  // The terminals of a brand need its settings, so anybody of the brand may read them. The scoped
  // client answers 404 for another brand. See docs/specs/009-settings.md.
  router.get('/:id/settings', async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    res.json(await service.getSettings(requestContext(req), id));
  });

  router.put('/:id/settings', requirePermission('settings:write'), async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    const input = parseWith(brandSettingsRequestSchema, req.body);
    res.json(await service.updateSettings(requestContext(req), id, input, requestMeta(req)));
  });

  router.get('/:id/branches', requirePermission('branches:read'), async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    const query = parseWith(cursorQuerySchema, req.query);
    res.json(await service.listBranches(requestContext(req), id, query));
  });

  router.post('/:id/branches', requirePermission('branches:write'), async (req, res) => {
    const { id } = parseWith(idParamsSchema, req.params);
    const input = parseWith(createBranchRequestSchema, req.body);
    res
      .status(201)
      .json(await service.createBranch(requestContext(req), id, input, requestMeta(req)));
  });

  return router;
}
