import { z } from 'zod';
import { permissionSchema, roleKeySchema, roleScopeSchema } from './access';
import { languageSchema } from './localized';

export const loginRequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('password'),
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(1).max(256),
  }),
  z.object({
    type: z.literal('pin'),
    branchId: z.uuid(),
    staffCode: z.string().trim().min(1).max(32),
    pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits'),
  }),
]);

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authUserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  role: z.object({ key: roleKeySchema, name: z.string() }),
  scope: roleScopeSchema,
  brandId: z.uuid().nullable(),
  branchIds: z.array(z.uuid()),
  permissions: z.array(permissionSchema),
  preferredLang: languageSchema,
});

export type AuthUser = z.infer<typeof authUserSchema>;

// Returned by login and refresh. The refresh token travels in an httpOnly cookie.
export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
  user: authUserSchema,
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

// The claims inside the access token. Branch ids are empty for brand and group scope.
export const accessTokenClaimsSchema = z.object({
  sub: z.uuid(),
  role: roleKeySchema,
  scope: roleScopeSchema,
  brandId: z.uuid().nullable(),
  branchIds: z.array(z.uuid()),
  permissions: z.array(permissionSchema),
});

export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;
