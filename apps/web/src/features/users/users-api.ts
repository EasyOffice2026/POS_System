import type { createUserRequestSchema } from '@pos/shared';
import {
  type AdminUser,
  adminUserSchema,
  credentialsResultSchema,
  pageSchema,
  type SetCredentialsRequest,
  type UpdateUserRequest,
  type UserListQuery,
} from '@pos/shared';
import type { z } from 'zod';
import { request } from '../../lib/api';
import { queryString } from '../../lib/query-string';

const userPage = pageSchema(adminUserSchema);

export type UserFilters = Pick<UserListQuery, 'role' | 'status' | 'q'>;

export function listUsersPage(filters: UserFilters, cursor?: string) {
  const query = queryString({ ...filters, limit: 25, cursor });
  return request(`/users${query}`, { schema: userPage });
}

export const getUser = (id: string) => request(`/users/${id}`, { schema: adminUserSchema });

// The request before the server applies defaults, so callers can leave out fields that have one.
export type CreateUserInput = z.input<typeof createUserRequestSchema>;

export const createUser = (body: CreateUserInput) =>
  request('/users', { method: 'POST', body, schema: adminUserSchema });

export const updateUser = (id: string, body: UpdateUserRequest) =>
  request(`/users/${id}`, { method: 'PATCH', body, schema: adminUserSchema });

export const setCredentials = (id: string, body: SetCredentialsRequest) =>
  request(`/users/${id}/credentials`, { method: 'POST', body, schema: credentialsResultSchema });

export const unlockUser = (id: string) =>
  request(`/users/${id}/unlock`, { method: 'POST', schema: adminUserSchema });

export type { AdminUser };
