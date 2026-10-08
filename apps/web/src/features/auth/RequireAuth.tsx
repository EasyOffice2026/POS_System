import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './auth-context';

// Only lets signed-in people through. Others go to the login page and come back afterwards.
export function RequireAuth() {
  const { status } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center text-slate-500">
        {t('common.loading')}
      </main>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
