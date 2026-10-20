import type { BranchMenu } from '@pos/shared';
import express from 'express';
import type { Config } from './config';
import { createMailer, type Mailer } from './lib/mailer';
import { createMemoryMenuCache, type MenuCache } from './lib/menu-cache';
import { createSupabaseStorage, type Storage } from './lib/storage';
import { createPasswordHasher, hashProfiles, type PasswordHasher } from './lib/password';
import type { PrismaClient } from './lib/prisma';
import { createTokenService } from './lib/tokens';
import { authenticate, withTenant } from './middleware/authenticate';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { type LogLine, requestLog, writeJsonLine } from './middleware/request-log';
import { securityHeaders } from './middleware/security-headers';
import { createAuditRouter } from './modules/audit/audit.router';
import { createAuthRouter } from './modules/auth/auth.router';
import { createAuthService } from './modules/auth/auth.service';
import { createBranchesRouter } from './modules/brands/branches.router';
import { createBrandsRouter } from './modules/brands/brands.router';
import { createBrandsService } from './modules/brands/brands.service';
import { createHealthRouter } from './modules/health/health.router';
import { createInventoryRouter } from './modules/inventory/inventory.router';
import { createInventoryService } from './modules/inventory/inventory.service';
import { createCountsService } from './modules/inventory/counts.service';
import { createPurchaseOrdersService } from './modules/inventory/purchase-orders.service';
import { createSuppliersService } from './modules/inventory/suppliers.service';
import { createTransfersService } from './modules/inventory/transfers.service';
import { createKitchenRouter } from './modules/kitchen/kitchen.router';
import { createKitchenService } from './modules/kitchen/kitchen.service';
import { createMenuRouter } from './modules/menu/menu.router';
import { createMenuService } from './modules/menu/menu.service';
import { createOrdersRouter } from './modules/orders/orders.router';
import { createOrdersService } from './modules/orders/orders.service';
import { createVoidAlerts } from './modules/orders/void-alerts';
import { createOverviewService } from './modules/reports/overview.service';
import { createReportsRouter } from './modules/reports/reports.router';
import { createReportsService } from './modules/reports/reports.service';
import { createCustomersRouter } from './modules/customers/customers.router';
import { createCustomersService } from './modules/customers/customers.service';
import { createTablesRouter } from './modules/tables/tables.router';
import { createTablesService } from './modules/tables/tables.service';
import { createRolesRouter } from './modules/roles/roles.router';
import { createShiftsRouter } from './modules/shifts/shifts.router';
import { createShiftsService } from './modules/shifts/shifts.service';
import { createUsersRouter } from './modules/users/users.router';
import { createUsersService } from './modules/users/users.service';
import { createUploadsRouter } from './modules/uploads/uploads.router';

export interface AppDeps {
  prisma: PrismaClient;
  config: Config;
  // Tests pass their own hasher to watch how it is used.
  hasher?: PasswordHasher;
  // Tests pass their own cache to watch it, or to move its clock.
  menuCache?: MenuCache;
  // Tests pass their own clock to open orders at a set time.
  now?: () => Date;
  // Where the line of each request goes: standard output, or nowhere while testing.
  log?: (line: LogLine) => void;
  // Tests pass their own mailer to see what would be sent.
  mailer?: Mailer;
  // Tests pass their own storage to see what would be kept.
  storage?: Storage;
}

export function createApp({
  prisma,
  config,
  hasher,
  menuCache,
  now,
  log,
  mailer,
  storage,
}: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(securityHeaders({ https: config.refreshToken.cookieSecure }));
  app.use(requestLog(log ?? (config.nodeEnv === 'test' ? () => {} : writeJsonLine)));
  app.use(express.json({ limit: '100kb' }));

  const tokens = createTokenService(config);
  const passwordHasher = hasher ?? createPasswordHasher(hashProfiles[config.passwordHashProfile]);
  const authService = createAuthService({ prisma, hasher: passwordHasher, tokens, config });
  const usersService = createUsersService({
    prisma,
    hasher: passwordHasher,
    revokeAllSessions: (userId) => authService.revokeAllSessions(userId),
  });

  const cache = menuCache ?? createMemoryMenuCache({ ttlMs: config.menuCacheTtlSeconds * 1000 });
  const brandsService = createBrandsService({ prisma, menuCache: cache });
  const menuService = createMenuService({ prisma, cache });
  const inventoryService = createInventoryService({ prisma, now: now ?? (() => new Date()) });
  const transfersService = createTransfersService({ prisma, now: now ?? (() => new Date()) });
  const countsService = createCountsService({ prisma, now: now ?? (() => new Date()) });
  const suppliersService = createSuppliersService({ prisma, now: now ?? (() => new Date()) });
  const purchaseOrdersService = createPurchaseOrdersService({
    prisma,
    now: now ?? (() => new Date()),
  });
  const voidAlerts = createVoidAlerts({
    prisma,
    mailer: mailer ?? createMailer(config.mail),
  });
  const ordersService = createOrdersService({
    prisma,
    notifyVoid: (event) => voidAlerts.send(event),
    hasher: passwordHasher,
    // The menu text was made by the menu service, so it has the shape of a branch menu.
    loadMenu: async (ctx, branchId) =>
      JSON.parse(await menuService.branchMenu.load(ctx, branchId)) as BranchMenu,
    now: now ?? (() => new Date()),
    deductStock: (tx, order, lines, by, at) =>
      inventoryService.sellForOrder(tx, order, lines, by, at),
  });
  const kitchenService = createKitchenService({
    now: now ?? (() => new Date()),
    prisma,
    deductStock: (tx, order, lines, by, at) =>
      inventoryService.sellForOrder(tx, order, lines, by, at),
  });
  const shiftsService = createShiftsService({ prisma, now: now ?? (() => new Date()) });

  const v1 = express.Router();
  v1.use('/health', createHealthRouter({ prisma }));
  v1.use(
    '/auth',
    createAuthRouter({ service: authService, authenticate: authenticate(tokens), config }),
  );

  // Routes below here need a signed-in person and get a database client limited to their data.
  const protectedRoutes = [authenticate(tokens), withTenant(prisma)];
  v1.use('/brands', ...protectedRoutes, createBrandsRouter({ service: brandsService }));
  v1.use('/branches', ...protectedRoutes, createBranchesRouter({ service: brandsService }));
  v1.use(
    '/branches',
    ...protectedRoutes,
    createTablesRouter({ service: createTablesService({ prisma }) }),
  );
  v1.use('/menu', ...protectedRoutes, createMenuRouter({ service: menuService }));
  v1.use('/orders', ...protectedRoutes, createOrdersRouter({ service: ordersService }));
  v1.use('/kitchen', ...protectedRoutes, createKitchenRouter({ service: kitchenService }));
  v1.use('/shifts', ...protectedRoutes, createShiftsRouter({ service: shiftsService }));
  v1.use(
    '/inventory',
    ...protectedRoutes,
    createInventoryRouter({
      service: inventoryService,
      transfers: transfersService,
      counts: countsService,
      suppliers: suppliersService,
      purchaseOrders: purchaseOrdersService,
    }),
  );
  v1.use('/users', ...protectedRoutes, createUsersRouter({ service: usersService }));
  v1.use(
    '/reports',
    ...protectedRoutes,
    createReportsRouter({
      service: createReportsService(),
      overview: createOverviewService({ now: now ?? (() => new Date()) }),
    }),
  );
  v1.use(
    '/customers',
    ...protectedRoutes,
    createCustomersRouter({
      service: createCustomersService({ prisma, now: now ?? (() => new Date()) }),
    }),
  );
  v1.use(
    '/uploads',
    ...protectedRoutes,
    createUploadsRouter({ storage: storage ?? createSupabaseStorage(config.storage) }),
  );
  v1.use('/roles', ...protectedRoutes, createRolesRouter());
  v1.use('/audit-logs', ...protectedRoutes, createAuditRouter());
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
