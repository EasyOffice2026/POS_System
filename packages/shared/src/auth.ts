import { z } from 'zod';
import { permissionSchema, roleKeySchema, roleScopeSchema } from './access';
import { passwordSchema } from './credentials';
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
  // A password given by a manager must be changed at the first sign-in; the owner is exempt
  // (docs/client-decisions.md).
  mustChangePassword: z.boolean(),
});

export type AuthUser = z.infer<typeof authUserSchema>;

// A signed-in person changes their own password: the current one proves it is them.
export const changePasswordRequestSchema = z
  .strictObject({
    currentPassword: z.string().min(1, 'PASSWORD_WRONG').max(256, 'PASSWORD_WRONG'),
    newPassword: passwordSchema,
  })
  .refine((input) => input.currentPassword !== input.newPassword, {
    path: ['newPassword'],
    message: 'PASSWORD_SAME',
  });
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

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
