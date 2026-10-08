import { Navigate, type RouteObject } from 'react-router';
import { AdminLayout } from '../features/admin/AdminLayout';
import { DashboardPage } from '../features/admin/DashboardPage';
import { AuditLogPage } from '../features/audit/AuditLogPage';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { RequirePermission } from '../features/auth/RequirePermission';
import { RolesPage } from '../features/roles/RolesPage';
import { UserFormPage } from '../features/users/UserFormPage';
import { UsersPage } from '../features/users/UsersPage';
import { NotFoundPage } from './NotFoundPage';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          {
            path: 'users',
            element: (
              <RequirePermission permission="users:read">
                <UsersPage />
              </RequirePermission>
            ),
          },
          {
            path: 'users/new',
            element: (
              <RequirePermission permission="users:write">
                <UserFormPage />
              </RequirePermission>
            ),
          },
          {
            path: 'users/:id',
            element: (
              <RequirePermission permission="users:write">
                <UserFormPage />
              </RequirePermission>
            ),
          },
          {
            path: 'roles',
            element: (
              <RequirePermission permission="roles:read">
                <RolesPage />
              </RequirePermission>
            ),
          },
          {
            path: 'audit',
            element: (
              <RequirePermission permission="audit:read">
                <AuditLogPage />
              </RequirePermission>
            ),
          },
        ],
      },
    ],
  },
  { path: '/', element: <Navigate to="/admin" replace /> },
  { path: '*', element: <NotFoundPage /> },
];
