import { Navigate, type RouteObject } from 'react-router';
import { AdminLayout } from '../features/admin/AdminLayout';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { RequirePermission } from '../features/auth/RequirePermission';
import { NotFoundPage } from './NotFoundPage';
import { lazyPage } from './lazy-page';

// Every page but the sign-in is loaded the first time it is opened (Phase 6, step 1).
const DashboardPage = lazyPage(() => import('../features/admin/DashboardPage'), 'DashboardPage');
const AuditLogPage = lazyPage(() => import('../features/audit/AuditLogPage'), 'AuditLogPage');
const BranchesPage = lazyPage(() => import('../features/branches/BranchesPage'), 'BranchesPage');
const KdsPage = lazyPage(() => import('../features/kitchen/KdsPage'), 'KdsPage');
const BranchFormPage = lazyPage(
  () => import('../features/branches/BranchFormPage'),
  'BranchFormPage',
);
const BranchPage = lazyPage(() => import('../features/branches/BranchPage'), 'BranchPage');
const BrandFormPage = lazyPage(() => import('../features/brands/BrandFormPage'), 'BrandFormPage');
const BrandsPage = lazyPage(() => import('../features/brands/BrandsPage'), 'BrandsPage');
const BranchMenuPreviewPage = lazyPage(
  () => import('../features/menu/BranchMenuPreviewPage'),
  'BranchMenuPreviewPage',
);
const CategoriesPage = lazyPage(() => import('../features/menu/CategoriesPage'), 'CategoriesPage');
const ComboPage = lazyPage(() => import('../features/menu/ComboPage'), 'ComboPage');
const CombosPage = lazyPage(() => import('../features/menu/CombosPage'), 'CombosPage');
const ItemPage = lazyPage(() => import('../features/menu/ItemPage'), 'ItemPage');
const ItemsPage = lazyPage(() => import('../features/menu/ItemsPage'), 'ItemsPage');
const PromotionsPage = lazyPage(() => import('../features/menu/PromotionsPage'), 'PromotionsPage');
const MenuIndexRedirect = lazyPage(
  () => import('../features/menu/MenuLayout'),
  'MenuIndexRedirect',
);
const MenuLayout = lazyPage(() => import('../features/menu/MenuLayout'), 'MenuLayout');
const PosPage = lazyPage(() => import('../features/pos/PosPage'), 'PosPage');
const PosSetupPage = lazyPage(() => import('../features/pos/PosSetupPage'), 'PosSetupPage');
const ReportsPage = lazyPage(() => import('../features/reports/ReportsPage'), 'ReportsPage');
const CustomerPage = lazyPage(() => import('../features/customers/CustomerPage'), 'CustomerPage');
const CustomersPage = lazyPage(
  () => import('../features/customers/CustomersPage'),
  'CustomersPage',
);
const RolesPage = lazyPage(() => import('../features/roles/RolesPage'), 'RolesPage');
const SettingsPage = lazyPage(() => import('../features/settings/SettingsPage'), 'SettingsPage');
const CountPage = lazyPage(() => import('../features/inventory/CountPage'), 'CountPage');
const CountsPage = lazyPage(() => import('../features/inventory/CountsPage'), 'CountsPage');
const IngredientsPage = lazyPage(
  () => import('../features/inventory/IngredientsPage'),
  'IngredientsPage',
);
const InventoryIndexRedirect = lazyPage(
  () => import('../features/inventory/InventoryLayout'),
  'InventoryIndexRedirect',
);
const InventoryLayout = lazyPage(
  () => import('../features/inventory/InventoryLayout'),
  'InventoryLayout',
);
const MovementsPage = lazyPage(
  () => import('../features/inventory/MovementsPage'),
  'MovementsPage',
);
const PurchaseOrderPage = lazyPage(
  () => import('../features/inventory/PurchaseOrderPage'),
  'PurchaseOrderPage',
);
const PurchaseOrdersPage = lazyPage(
  () => import('../features/inventory/PurchaseOrdersPage'),
  'PurchaseOrdersPage',
);
const StockPage = lazyPage(() => import('../features/inventory/StockPage'), 'StockPage');
const SupplierPage = lazyPage(() => import('../features/inventory/SupplierPage'), 'SupplierPage');
const SuppliersPage = lazyPage(
  () => import('../features/inventory/SuppliersPage'),
  'SuppliersPage',
);
const TransfersPage = lazyPage(
  () => import('../features/inventory/TransfersPage'),
  'TransfersPage',
);
const ShiftsPage = lazyPage(() => import('../features/shifts/ShiftsPage'), 'ShiftsPage');
const UserFormPage = lazyPage(() => import('../features/users/UserFormPage'), 'UserFormPage');
const UsersPage = lazyPage(() => import('../features/users/UsersPage'), 'UsersPage');

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
