import type { AccessTokenClaims } from '@pos/shared';
import type { Request, RequestHandler } from 'express';
import { errors } from '../lib/http-errors';
import type { PrismaClient } from '../lib/prisma';
import type { TokenService } from '../lib/tokens';
import { createScopedClient, type ScopedClient } from '../tenancy/scoped-client';

// Reads the bearer token and puts the person's claims on the request.
export function authenticate(tokens: TokenService): RequestHandler {
  return async (req, _res, next) => {
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw errors.unauthenticated();
    }
    req.auth = await tokens.verifyAccessToken(token);
    next();
  };
}

// Gives the request a database client limited to the signed-in person's brand and branches.
export function withTenant(prisma: PrismaClient): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw errors.unauthenticated();
    req.db = createScopedClient(prisma, {
      scope: req.auth.scope,
      brandId: req.auth.brandId,
      branchIds: req.auth.branchIds,
    });
    next();
  };
}

// For route handlers behind authenticate and withTenant.
export function requestContext(req: Request): { auth: AccessTokenClaims; db: ScopedClient } {
  if (!req.auth || !req.db) throw errors.unauthenticated();
  return { auth: req.auth, db: req.db };
}
