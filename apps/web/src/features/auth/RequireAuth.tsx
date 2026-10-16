import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './auth-context';

// Only lets signed-in people through. Others go to the login page and come back afterwards.
export function RequireAuth() {
  const { status, user } = useAuth();
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
    // The query string comes back too, for example /pos/setup?next=/kds.
    return (
      <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
    );
  }
  // A password a manager gave is changed before anything else (docs/client-decisions.md).
  if (user?.mustChangePassword && location.pathname !== '/change-password') {
    return (
      <Navigate
        to="/change-password"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }
  return <Outlet />;
}
