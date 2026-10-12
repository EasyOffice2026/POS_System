import { z } from 'zod';

// A role's scope decides which data a person can see.
export const roleScopes = ['GROUP', 'BRAND', 'BRANCH'] as const;
export const roleScopeSchema = z.enum(roleScopes);
export type RoleScope = z.infer<typeof roleScopeSchema>;

// Permissions are checked by the API on every route. Later phases add their own.
export const permissions = [
  'brands:read',
  'brands:write',
  'branches:read',
  'branches:write',
  'users:read',
  'users:write',
  'roles:read',
  'menu:read',
  'menu:write',
  'orders:read',
  'orders:write',
  'orders:void',
  'orders:discount',
  'audit:read',
] as const;
export const permissionSchema = z.enum(permissions);
export type Permission = z.infer<typeof permissionSchema>;

export const roleKeys = [
  'group_admin',
  'brand_manager',
  'marketing',
  'branch_manager',
  'cashier',
  'kitchen',
  'purchaser',
] as const;
export const roleKeySchema = z.enum(roleKeys);
export type RoleKey = z.infer<typeof roleKeySchema>;

export interface RoleDefinition {
  key: RoleKey;
  name: string;
  scope: RoleScope;
  permissions: readonly Permission[];
}

// The built-in roles. The API writes these to the database at startup.
// The permission matrix is a draft: see docs/specs/001-auth-and-tenancy.md.
export const systemRoles: readonly RoleDefinition[] = [
  { key: 'group_admin', name: 'Group Admin', scope: 'GROUP', permissions },
  {
    key: 'brand_manager',
    name: 'Brand Manager',
    scope: 'BRAND',
    permissions: [
      'brands:read',
      'branches:read',
      'branches:write',
      'users:read',
      'users:write',
      'roles:read',
      'menu:read',
      'menu:write',
      'orders:read',
      'orders:write',
      'orders:void',
      'orders:discount',
      'audit:read',
    ],
  },
  {
    key: 'marketing',
    name: 'Marketing',
    scope: 'BRAND',
    permissions: ['brands:read', 'branches:read', 'menu:read'],
  },
  {
    key: 'branch_manager',
    name: 'Branch Manager',
    scope: 'BRANCH',
    permissions: [
      'branches:read',
      'users:read',
      'menu:read',
      'orders:read',
      'orders:write',
      'orders:void',
      'orders:discount',
    ],
  },
  {
    key: 'cashier',
    name: 'Cashier',
    scope: 'BRANCH',
    permissions: ['menu:read', 'orders:read', 'orders:write'],
  },
  {
    key: 'kitchen',
    name: 'Kitchen',
    scope: 'BRANCH',
    permissions: ['menu:read', 'orders:read'],
  },
  {
    key: 'purchaser',
    name: 'Purchaser',
    scope: 'BRANCH',
    permissions: ['branches:read', 'menu:read'],
  },
];
