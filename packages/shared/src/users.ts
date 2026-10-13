import { z } from 'zod';
import { permissionSchema, roleKeySchema, roleScopeSchema } from './access';
import { passwordSchema, pinSchema } from './credentials';
import { languageSchema } from './localized';
import { cursorQuerySchema } from './pagination';

// A person as seen by a manager. Never contains a password or PIN, or their hashes.
export const adminUserSchema = z.object({
  id: z.uuid(),
  brandId: z.uuid().nullable(),
  name: z.string(),
  email: z.string().nullable(),
  staffCode: z.string().nullable(),
  role: z.object({ key: roleKeySchema, name: z.string(), scope: roleScopeSchema }),
  branchIds: z.array(z.uuid()),
  preferredLang: languageSchema,
  isActive: z.boolean(),
  // Set only while the account is locked.
  lockedUntil: z.iso.datetime().nullable(),
  hasPassword: z.boolean(),
  hasPin: z.boolean(),
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type AdminUser = z.infer<typeof adminUserSchema>;

const emailField = z.string().trim().toLowerCase().pipe(z.email());
const nameField = z.string().trim().min(1).max(100);
const staffCodeField = z.string().trim().min(1).max(32);

// Unknown fields are refused, so a request cannot slip in a field it should not control.
export const createUserRequestSchema = z
  .strictObject({
    name: nameField,
    email: emailField.optional(),
    staffCode: staffCodeField.optional(),
    roleKey: roleKeySchema,
    // Only a group admin chooses the brand. Everybody else creates users in their own brand.
    brandId: z.uuid().optional(),
    branchIds: z.array(z.uuid()).max(50).default([]),
    preferredLang: languageSchema.default('en'),
    password: passwordSchema.optional(),
    pin: pinSchema.optional(),
  })
  .superRefine((request, ctx) => {
    if (!request.email && !request.staffCode) {
      ctx.addIssue({ code: 'custom', path: ['email'], message: 'EMAIL_OR_STAFF_CODE_REQUIRED' });
    }
    if (request.password && !request.email) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: 'PASSWORD_NEEDS_EMAIL' });
    }
    if (request.pin && !request.staffCode) {
      ctx.addIssue({ code: 'custom', path: ['pin'], message: 'PIN_NEEDS_STAFF_CODE' });
    }
  });

export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const updateUserRequestSchema = z
  .strictObject({
    name: nameField.optional(),
    email: emailField.nullable().optional(),
    staffCode: staffCodeField.nullable().optional(),
    roleKey: roleKeySchema.optional(),
    branchIds: z.array(z.uuid()).max(50).optional(),
    preferredLang: languageSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((request) => Object.keys(request).length > 0, { message: 'NOTHING_TO_UPDATE' });

export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

export const userStatuses = ['active', 'inactive', 'locked'] as const;
export const userStatusSchema = z.enum(userStatuses);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const userListQuerySchema = cursorQuerySchema.extend({
  role: roleKeySchema.optional(),
  status: userStatusSchema.optional(),
  // Matches part of the name, email or staff code.
  q: z.string().trim().min(1).max(100).optional(),
  branchId: z.uuid().optional(),
  // Only a group admin can narrow by brand.
  brandId: z.uuid().optional(),
});

export type UserListQuery = z.infer<typeof userListQuerySchema>;

// A built-in role with its permissions. "assignable" says whether the person asking may give
// this role to someone.
export const roleInfoSchema = z.object({
  key: roleKeySchema,
  name: z.string(),
  scope: roleScopeSchema,
  permissions: z.array(permissionSchema),
  assignable: z.boolean(),
});

export type RoleInfo = z.infer<typeof roleInfoSchema>;
