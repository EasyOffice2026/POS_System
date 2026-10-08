import type { Permission } from '@pos/shared';
import type { RequestHandler } from 'express';
import { errors } from '../lib/http-errors';

// Lets the request through only when the person's token grants every listed permission.
export function requirePermission(...needed: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const granted = req.auth?.permissions ?? [];
    if (!needed.every((permission) => granted.includes(permission))) {
      throw errors.forbidden();
    }
    next();
  };
}
