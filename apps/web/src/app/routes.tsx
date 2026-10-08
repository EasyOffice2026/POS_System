import { Navigate, type RouteObject } from 'react-router';
import { AdminLayout } from '../features/admin/AdminLayout';
import { DashboardPage } from '../features/admin/DashboardPage';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { NotFoundPage } from './NotFoundPage';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [{ index: true, element: <DashboardPage /> }],
      },
    ],
  },
  { path: '/', element: <Navigate to="/admin" replace /> },
  { path: '*', element: <NotFoundPage /> },
];
