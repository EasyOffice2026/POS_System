import { type Branch, type Brand, cursorQuerySchema, localizedTextSchema } from '@pos/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { Branch as BranchRow, Brand as BrandRow } from '../../generated/prisma/client';
import { errors } from '../../lib/http-errors';
import { cursorPageArgs, toPage } from '../../lib/pagination';
import { parseWith } from '../../lib/validate';
import { requestContext } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';

const brandParamsSchema = z.object({ id: z.uuid() });

function toBrand(row: BrandRow): Brand {
  return {
    id: row.id,
    name: localizedTextSchema.parse(row.name),
    logoUrl: row.logoUrl,
    createdAt: row.createdAt.toISOString(),
  };
}

function toBranch(row: BranchRow): Branch {
  return {
    id: row.id,
    brandId: row.brandId,
    name: localizedTextSchema.parse(row.name),
    address: row.address,
    timezone: row.timezone,
    isActive: row.isActive,
  };
}

// Both routes read through the scoped client, so each person only gets their own data.
export function createBrandsRouter(): Router {
  const router = Router();

  router.get('/', requirePermission('brands:read'), async (req, res) => {
    const { db } = requestContext(req);
    const { limit, cursor } = parseWith(cursorQuerySchema, req.query);

    const rows = await db.brand.findMany(cursorPageArgs(limit, cursor));
    res.json(toPage(rows, limit, toBrand));
  });

  router.get('/:id/branches', requirePermission('branches:read'), async (req, res) => {
    const { db } = requestContext(req);
    const { id } = parseWith(brandParamsSchema, req.params);
    const { limit, cursor } = parseWith(cursorQuerySchema, req.query);

    // A brand the person cannot see is answered like one that does not exist.
    const brand = await db.brand.findUnique({ where: { id } });
    if (!brand) throw errors.notFound('Brand');

    const rows = await db.branch.findMany({
      where: { brandId: id },
      ...cursorPageArgs(limit, cursor),
    });
    res.json(toPage(rows, limit, toBranch));
  });

  return router;
}
