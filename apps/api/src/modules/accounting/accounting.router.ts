import { type Request, type RequestHandler, Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/authorize';
import { errors } from '../../lib/http-errors';
import { parseWith } from '../../lib/validate';
import type { AccountingService } from './accounting.service';

const rangeQuery = z.strictObject({ from: z.iso.date(), to: z.iso.date() });
const idParams = z.object({ id: z.uuid() });
const money = z.string().regex(/^\d{1,9}(\.\d{1,3})?$/);
const stockPostBody = z.strictObject({
  key: z.string().trim().min(1).max(200),
  branchId: z.uuid(),
  kind: z.enum(['received', 'transfer_in', 'transfer_out']),
  at: z.iso.datetime().optional(),
  note: z.string().max(500).optional(),
  lines: z
    .array(z.strictObject({ ingredientId: z.uuid(), quantity: money, unitCost: money.optional() }))
    .min(1)
    .max(500),
});
const createKeyBody = z.strictObject({ name: z.string().trim().min(1).max(100) });

// The routes the ERP uses with its integration key (docs/specs/029-erp-link.md). It reads the
// figures, and posts the stock it bought and transferred, since purchases are entered there.
export function createAccountingRouter({ service }: { service: AccountingService }): Router {
  const router = Router();

  const authenticateKey: RequestHandler = async (req, res, next) => {
    const [scheme, key] = (req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !key) throw errors.unauthenticated();
    const integration = await service.authenticate(key);
    if (!integration) throw errors.unauthenticated();
    res.locals.integration = integration;
    next();
  };
  router.use(authenticateKey);

  router.get('/structure', async (_req, res) => {
    res.json(await service.structure());
  });
  router.get('/days', async (req, res) => {
    res.json(await service.days(parseWith(rangeQuery, req.query)));
  });
  router.get('/goods-receipts', async (req, res) => {
    res.json(await service.goodsReceipts(parseWith(rangeQuery, req.query)));
  });
  router.get('/ingredients', async (_req, res) => {
    res.json(await service.ingredients());
  });
  router.get('/stock-costs', async (req, res) => {
    res.json(await service.stockCosts(parseWith(rangeQuery, req.query)));
  });
  router.post('/stock', async (req, res) => {
    const result = await service.postStock(parseWith(stockPostBody, req.body));
    res.status(result.duplicate ? 200 : 201).json(result);
  });
  return router;
}

// Only a group administrator (who sees every brand) makes or revokes the keys.
const requireGroup: RequestHandler = (req, _res, next) => {
  if (req.auth?.scope !== 'GROUP') throw errors.forbidden();
  next();
};
const userOf = (req: Request) => {
  if (!req.auth) throw errors.unauthenticated();
  return req.auth.sub;
};

export function createIntegrationKeysRouter({ service }: { service: AccountingService }): Router {
  const router = Router();
  router.use(requireGroup, requirePermission('brands:write'));

  router.get('/', async (_req, res) => {
    res.json(await service.listKeys());
  });
  router.post('/', async (req, res) => {
    const { name } = parseWith(createKeyBody, req.body);
    res.status(201).json(await service.createKey(name, userOf(req)));
  });
  router.delete('/:id', async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    await service.revokeKey(id);
    res.status(204).end();
  });
  return router;
}
