import type { AccessTokenClaims } from '@pos/shared';
import type { ScopedClient } from '../tenancy/scoped-client';

declare module 'express-serve-static-core' {
  interface Request {
    // Set by the authenticate middleware.
    auth?: AccessTokenClaims;
    // Set by the withTenant middleware: a database client limited to the person's data.
    db?: ScopedClient;
  }
}
