import { type Permission, permissions } from '@pos/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listRoles } from './roles-api';

// i18n keys cannot hold a colon, so each permission has its own text key.
const permissionKeys = {
  'brands:read': 'permissions.brands_read',
  'brands:write': 'permissions.brands_write',
  'branches:read': 'permissions.branches_read',
  'branches:write': 'permissions.branches_write',
  'users:read': 'permissions.users_read',
  'users:write': 'permissions.users_write',
  'roles:read': 'permissions.roles_read',
  'menu:read': 'permissions.menu_read',
  'menu:write': 'permissions.menu_write',
  'orders:read': 'permissions.orders_read',
  'orders:write': 'permissions.orders_write',
  'orders:void': 'permissions.orders_void',
  'orders:discount': 'permissions.orders_discount',
  'kitchen:write': 'permissions.kitchen_write',
  'settings:write': 'permissions.settings_write',
  'shifts:read': 'permissions.shifts_read',
  'orders:refund': 'permissions.orders_refund',
  'audit:read': 'permissions.audit_read',
} as const satisfies Record<Permission, string>;

// The permission matrix: what each built-in role may do.
export function RolesPage() {
  const { t } = useTranslation();
  const roles = useQuery({ queryKey: ['roles'], queryFn: listRoles });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('rolesPage.title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('rolesPage.intro')}</p>
      </div>

      {roles.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {roles.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}

      {roles.data && (
        // `relative` keeps the screen-reader text (absolutely placed) inside the scrolling box.
        <div className="relative overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-start text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('rolesPage.permission')}
                </th>
                {roles.data.map((role) => (
                  <th key={role.key} scope="col" className="px-3 py-2 text-center font-medium">
                    {t(`roles.${role.key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-slate-50/50">
                <th scope="row" className="px-3 py-2 text-start font-medium text-slate-600">
                  {t('rolesPage.scope')}
                </th>
                {roles.data.map((role) => (
                  <td key={role.key} className="px-3 py-2 text-center text-slate-700">
                    {t(`scopes.${role.scope}`)}
                  </td>
                ))}
              </tr>
              {permissions.map((permission) => (
                <tr key={permission}>
                  <th scope="row" className="px-3 py-2 text-start font-normal text-slate-800">
                    {t(permissionKeys[permission])}
                  </th>
                  {roles.data.map((role) => {
                    const allowed = role.permissions.includes(permission);
                    return (
                      <td key={role.key} className="px-3 py-2 text-center">
                        <span aria-hidden="true">{allowed ? '✓' : '—'}</span>
                        <span className="sr-only">
                          {allowed ? t('rolesPage.allowed') : t('rolesPage.notAllowed')}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
