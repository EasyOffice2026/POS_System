import type { Permission } from '@pos/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './auth-context';

// Shows a page only to people who have the permission. This only spares people a screen that
// would fail: the server checks the permission on every request anyway.
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();

  if (!user?.permissions.includes(permission)) {
    return (
      <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
        {t('common.noPermission')}
      </p>
    );
  }
  return <>{children}</>;
}
