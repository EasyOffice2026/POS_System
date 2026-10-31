import { failPrintJobRequestSchema } from '@pos/shared';
import { type Request, type RequestHandler, Router } from 'express';
import { z } from 'zod';
import { errors } from '../../lib/http-errors';
import { parseWith } from '../../lib/validate';
import type { BridgeContext, PrintingService } from './printing.service';

const idParams = z.object({ id: z.uuid() });

interface BridgeRouterDeps {
  service: PrintingService;
  // How long a claim waits for a job before answering that there is none.
  waitMs: number;
}

function bridgeOf(req: Request): BridgeContext {
  const bridge: unknown = req.res?.locals.bridge;
  if (!bridge) throw errors.unauthenticated();
  return bridge as BridgeContext;
}

// The routes of the print bridge itself. It is not a person: it signs in with the key of its
// branch and reaches nothing but that branch's jobs. See docs/specs/028-print-bridge.md, rule 3.
export function createPrintBridgeRouter({ service, waitMs }: BridgeRouterDeps): Router {
  const router = Router();

  const authenticateBridge: RequestHandler = async (req, res, next) => {
    const [scheme, key] = (req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !key) throw errors.unauthenticated();
    const bridge = await service.authenticateBridge(key);
    if (!bridge) throw errors.unauthenticated();
    res.locals.bridge = bridge;
    next();
  };
  router.use(authenticateBridge);

  router.get('/', async (req, res) => {
    res.json(await service.info(bridgeOf(req)));
  });

  router.post('/jobs/claim', async (req, res) => {
    const job = await service.claim(bridgeOf(req), waitMs);
    if (job) res.json(job);
    else res.status(204).end();
  });

  router.post('/jobs/:id/done', async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    await service.done(bridgeOf(req), id);
    res.status(204).end();
  });

  router.post('/jobs/:id/failed', async (req, res) => {
    const { id } = parseWith(idParams, req.params);
    const { error } = parseWith(failPrintJobRequestSchema, req.body);
    await service.failed(bridgeOf(req), id, error);
    res.status(204).end();
  });

  return router;
}
