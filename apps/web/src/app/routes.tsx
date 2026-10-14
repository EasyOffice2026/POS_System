import { Navigate, type RouteObject } from 'react-router';
import { AdminLayout } from '../features/admin/AdminLayout';
import { DashboardPage } from '../features/admin/DashboardPage';
import { AuditLogPage } from '../features/audit/AuditLogPage';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { RequirePermission } from '../features/auth/RequirePermission';
import { BranchesPage } from '../features/branches/BranchesPage';
import { KdsPage } from '../features/kitchen/KdsPage';
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
import { PromotionsPage } from '../features/menu/PromotionsPage';
import { MenuIndexRedirect, MenuLayout } from '../features/menu/MenuLayout';
import { PosPage } from '../features/pos/PosPage';
import { PosSetupPage } from '../features/pos/PosSetupPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { CustomerPage } from '../features/customers/CustomerPage';
import { CustomersPage } from '../features/customers/CustomersPage';
import { RolesPage } from '../features/roles/RolesPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { CountPage } from '../features/inventory/CountPage';
import { CountsPage } from '../features/inventory/CountsPage';
import { IngredientsPage } from '../features/inventory/IngredientsPage';
import { InventoryIndexRedirect, InventoryLayout } from '../features/inventory/InventoryLayout';
import { MovementsPage } from '../features/inventory/MovementsPage';
import { PurchaseOrderPage } from '../features/inventory/PurchaseOrderPage';
import { PurchaseOrdersPage } from '../features/inventory/PurchaseOrdersPage';
import { StockPage } from '../features/inventory/StockPage';
import { SupplierPage } from '../features/inventory/SupplierPage';
import { SuppliersPage } from '../features/inventory/SuppliersPage';
import { TransfersPage } from '../features/inventory/TransfersPage';
import { ShiftsPage } from '../features/shifts/ShiftsPage';
import { UserFormPage } from '../features/users/UserFormPage';
import { UsersPage } from '../features/users/UsersPage';
import { NotFoundPage } from './NotFoundPage';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  // The terminal shows its own PIN screen to people who are not signed in.
  { path: '/pos', element: <PosPage /> },
  { path: '/kds', element: <KdsPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/pos/setup',
        element: (
          <RequirePermission permission="branches:read">
            <PosSetupPage />
          </RequirePermission>
        ),
      },
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
              { path: 'promotions', element: <PromotionsPage /> },
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
            path: 'inventory',
            element: (
              <RequirePermission permission="inventory:read">
                <InventoryLayout />
              </RequirePermission>
            ),
            children: [
              { index: true, element: <InventoryIndexRedirect /> },
              { path: 'ingredients', element: <IngredientsPage /> },
              { path: 'stock', element: <StockPage /> },
              { path: 'movements', element: <MovementsPage /> },
              { path: 'transfers', element: <TransfersPage /> },
              { path: 'counts', element: <CountsPage /> },
              { path: 'counts/:id', element: <CountPage /> },
              { path: 'suppliers', element: <SuppliersPage /> },
              { path: 'suppliers/:id', element: <SupplierPage /> },
              { path: 'purchase-orders', element: <PurchaseOrdersPage /> },
              { path: 'purchase-orders/:id', element: <PurchaseOrderPage /> },
            ],
          },
          {
            path: 'reports',
            element: (
              <RequirePermission permission="reports:read">
                <ReportsPage />
              </RequirePermission>
            ),
          },
          {
            path: 'customers',
            element: (
              <RequirePermission permission="customers:read">
                <CustomersPage />
              </RequirePermission>
            ),
          },
          {
            path: 'customers/:id',
            element: (
              <RequirePermission permission="customers:read">
                <CustomerPage />
              </RequirePermission>
            ),
          },
          {
            path: 'shifts',
            element: (
              <RequirePermission permission="shifts:read">
                <ShiftsPage />
              </RequirePermission>
            ),
          },
          {
            path: 'settings',
            element: (
              <RequirePermission permission="settings:write">
                <SettingsPage />
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
