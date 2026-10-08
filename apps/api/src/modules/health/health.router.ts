import type { HealthResponse } from '@pos/shared';
import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const body: HealthResponse = { status: 'ok', service: 'api' };
  res.json(body);
});
