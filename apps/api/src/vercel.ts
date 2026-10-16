import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app';
import { type Config, loadConfig } from './config';
import { createPrismaClient, type PrismaClient } from './lib/prisma';
import { syncSystemRoles } from './lib/roles';

// The API as a Vercel function (docs/deployment.md, "Vercel"). Vercel starts a copy of this
// module when traffic needs one and keeps it for later requests, so the app and its database
// connections are made once per copy, and the built-in roles are written once per copy before
// its first request, as server.ts does at start-up.
export function createVercelHandler({ prisma, config }: { prisma: PrismaClient; config: Config }) {
  const app = createApp({ prisma, config });
  let ready: Promise<void> | null = null;

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // The routes expect /api/v1/...; should the platform hand over the path without /api, it is
    // put back.
    if (req.url && !req.url.startsWith('/api/') && req.url !== '/api') {
      req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
    }
    ready ??= syncSystemRoles(prisma).catch((error: unknown) => {
      ready = null;
      throw error;
    });
    await ready;
    app(req, res);
  };
}

const config = loadConfig();
export default createVercelHandler({ prisma: createPrismaClient(config.databaseUrl), config });
