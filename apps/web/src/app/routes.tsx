import { Navigate, type RouteObject } from 'react-router';
import { AdminLayout } from '../features/admin/AdminLayout';
import { DashboardPage } from '../features/admin/DashboardPage';
import { AuditLogPage } from '../features/audit/AuditLogPage';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { RequirePermission } from '../features/auth/RequirePermission';
import { BranchesPage } from '../features/branches/BranchesPage';
import { BranchFormPage } from '../features/branches/BranchFormPage';
import { BranchPage } from '../features/branches/BranchPage';
import { BrandFormPage } from '../features/brands/BrandFormPage';
import { BrandsPage } from '../features/brands/BrandsPage';
import { BranchMenuPreviewPage } from '../features/menu/BranchMenuPreviewPage';
import { CategoriesPage } from '../features/menu/CategoriesPage';
import { ComboPage } from '../features/menu/ComboPage';
import { CombosPage } from '../features/menu/CombosPage';
import { ItemPage } from '../features/menu/ItemPage';
import { ItemsPage } from '../features/menu/ItemsPage';
import { MenuIndexRedirect, MenuLayout } from '../features/menu/MenuLayout';
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
            path: 'brands',
            element: (
              <RequirePermission permission="brands:read">
                <BrandsPage />
              </RequirePermission>
            ),
          },
          {
            path: 'brands/new',
            element: (
              <RequirePermission permission="brands:write">
                <BrandFormPage />
              </RequirePermission>
            ),
          },
          {
            path: 'brands/:id',
            element: (
              <RequirePermission permission="brands:write">
                <BrandFormPage />
              </RequirePermission>
            ),
          },
          {
            path: 'branches',
            element: (
              <RequirePermission permission="branches:read">
                <BranchesPage />
              </RequirePermission>
            ),
          },
          {
            path: 'branches/new',
            element: (
              <RequirePermission permission="branches:write">
                <BranchFormPage />
              </RequirePermission>
            ),
          },
          {
            path: 'branches/:id',
            element: (
              <RequirePermission permission="branches:read">
                <BranchPage />
              </RequirePermission>
            ),
          },
          {
            path: 'menu',
            element: (
              <RequirePermission permission="menu:read">
                <MenuLayout />
              </RequirePermission>
            ),
            children: [
              { index: true, element: <MenuIndexRedirect /> },
              { path: 'items', element: <ItemsPage /> },
              { path: 'categories', element: <CategoriesPage /> },
              { path: 'combos', element: <CombosPage /> },
              { path: 'preview', element: <BranchMenuPreviewPage /> },
            ],
          },
          {
            path: 'menu/combos/new',
            element: (
              <RequirePermission permission="menu:write">
                <ComboPage />
              </RequirePermission>
            ),
          },
          {
            path: 'menu/combos/:id',
            element: (
              <RequirePermission permission="menu:read">
                <ComboPage />
              </RequirePermission>
            ),
          },
          {
            path: 'menu/items/new',
            element: (
              <RequirePermission permission="menu:write">
                <ItemPage />
              </RequirePermission>
            ),
          },
          {
            path: 'menu/items/:id',
            element: (
              <RequirePermission permission="menu:read">
                <ItemPage />
              </RequirePermission>
            ),
          },
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
