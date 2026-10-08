import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import { useAuth } from '../auth/auth-context';

export function AdminLayout() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <p className="text-lg font-semibold">{t('app.name')}</p>

        <div className="flex flex-wrap items-center gap-3">
          {user && (
            <p className="text-sm text-slate-600">
              <span className="font-medium text-slate-900">{user.name}</span>
              <span className="mx-2 text-slate-300" aria-hidden="true">
                |
              </span>
              <span>{t(`roles.${user.role.key}`)}</span>
            </p>
          )}
          <LanguageSwitcher />
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-md bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-700 focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:outline-none"
          >
            {t('auth.signOut')}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-4">
        <Outlet />
      </main>
    </div>
  );
}
