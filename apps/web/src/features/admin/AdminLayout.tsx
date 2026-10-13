import type { Permission } from '@pos/shared';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import { useAuth } from '../auth/auth-context';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${
    isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
  }`;

export function AdminLayout() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const can = (permission: Permission) => user?.permissions.includes(permission) ?? false;

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

      <nav
        aria-label={t('nav.label')}
        className="flex flex-wrap gap-1 border-b border-slate-200 bg-white px-4 py-2"
      >
        <NavLink to="/admin" end className={linkClass}>
          {t('nav.dashboard')}
        </NavLink>
        {can('brands:read') && (
          <NavLink to="/admin/brands" className={linkClass}>
            {t('nav.brands')}
          </NavLink>
        )}
        {can('branches:read') && (
          <NavLink to="/admin/branches" className={linkClass}>
            {t('nav.branches')}
          </NavLink>
        )}
        {can('menu:read') && (
          <NavLink to="/admin/menu" className={linkClass}>
            {t('nav.menu')}
          </NavLink>
        )}
        {can('orders:write') && (
          <NavLink to="/pos" className={linkClass}>
            {t('nav.pos')}
          </NavLink>
        )}
        {can('kitchen:write') && (
          <NavLink to="/kds" className={linkClass}>
            {t('nav.kds')}
          </NavLink>
        )}
        {can('users:read') && (
          <NavLink to="/admin/users" className={linkClass}>
            {t('nav.users')}
          </NavLink>
        )}
        {can('roles:read') && (
          <NavLink to="/admin/roles" className={linkClass}>
            {t('nav.roles')}
          </NavLink>
        )}
        {can('inventory:read') && (
          <NavLink to="/admin/inventory" className={linkClass}>
            {t('nav.inventory')}
          </NavLink>
        )}
        {can('shifts:read') && (
          <NavLink to="/admin/shifts" className={linkClass}>
            {t('nav.shifts')}
          </NavLink>
        )}
        {can('settings:write') && (
          <NavLink to="/admin/settings" className={linkClass}>
            {t('nav.settings')}
          </NavLink>
        )}
        {can('audit:read') && (
          <NavLink to="/admin/audit" className={linkClass}>
            {t('nav.audit')}
          </NavLink>
        )}
      </nav>

      <main className="mx-auto max-w-5xl p-4">
        <Outlet />
      </main>
    </div>
  );
}
