import { apiError, type HealthResponse } from '@pos/shared';
import { Router } from 'express';
import type { PrismaClient } from '../../lib/prisma';

// Two checks for the host (docs/deployment.md):
// - GET /health: the API process is up. Use it to restart a stuck container.
// - GET /health/ready: the API can also reach its database. Use it to send traffic.
export function createHealthRouter({ prisma }: { prisma: PrismaClient }): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const body: HealthResponse = { status: 'ok', service: 'api' };
    res.json(body);
  });

  router.get('/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const body: HealthResponse = { status: 'ok', service: 'api' };
      res.json(body);
    } catch {
      res.status(503).json(apiError('DATABASE_UNAVAILABLE', 'The database cannot be reached'));
    }
  });

  return router;
}
