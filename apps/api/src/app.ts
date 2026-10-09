import express from 'express';
import type { Config } from './config';
import { createMemoryMenuCache, type MenuCache } from './lib/menu-cache';
import { createPasswordHasher, hashProfiles, type PasswordHasher } from './lib/password';
import type { PrismaClient } from './lib/prisma';
import { createTokenService } from './lib/tokens';
import { authenticate, withTenant } from './middleware/authenticate';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { createAuditRouter } from './modules/audit/audit.router';
import { createAuthRouter } from './modules/auth/auth.router';
import { createAuthService } from './modules/auth/auth.service';
import { createBranchesRouter } from './modules/brands/branches.router';
import { createBrandsRouter } from './modules/brands/brands.router';
import { createBrandsService } from './modules/brands/brands.service';
import { healthRouter } from './modules/health/health.router';
import { createMenuRouter } from './modules/menu/menu.router';
import { createMenuService } from './modules/menu/menu.service';
import { createRolesRouter } from './modules/roles/roles.router';
import { createUsersRouter } from './modules/users/users.router';
import { createUsersService } from './modules/users/users.service';

export interface AppDeps {
  prisma: PrismaClient;
  config: Config;
  // Tests pass their own hasher to watch how it is used.
  hasher?: PasswordHasher;
  // Tests pass their own cache to watch it, or to move its clock.
  menuCache?: MenuCache;
}

export function createApp({ prisma, config, hasher, menuCache }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(express.json({ limit: '100kb' }));

  const tokens = createTokenService(config);
  const passwordHasher = hasher ?? createPasswordHasher(hashProfiles[config.passwordHashProfile]);
  const authService = createAuthService({ prisma, hasher: passwordHasher, tokens, config });
  const usersService = createUsersService({
    prisma,
    hasher: passwordHasher,
    revokeAllSessions: (userId) => authService.revokeAllSessions(userId),
  });

  const brandsService = createBrandsService({ prisma });
  const menuService = createMenuService({
    prisma,
    cache: menuCache ?? createMemoryMenuCache({ ttlMs: config.menuCacheTtlSeconds * 1000 }),
  });

  const v1 = express.Router();
  v1.use('/health', healthRouter);
  v1.use(
    '/auth',
    createAuthRouter({ service: authService, authenticate: authenticate(tokens), config }),
  );

  // Routes below here need a signed-in person and get a database client limited to their data.
  const protectedRoutes = [authenticate(tokens), withTenant(prisma)];
  v1.use('/brands', ...protectedRoutes, createBrandsRouter({ service: brandsService }));
  v1.use('/branches', ...protectedRoutes, createBranchesRouter({ service: brandsService }));
  v1.use('/menu', ...protectedRoutes, createMenuRouter({ service: menuService }));
  v1.use('/users', ...protectedRoutes, createUsersRouter({ service: usersService }));
  v1.use('/roles', ...protectedRoutes, createRolesRouter());
  v1.use('/audit-logs', ...protectedRoutes, createAuditRouter());
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
