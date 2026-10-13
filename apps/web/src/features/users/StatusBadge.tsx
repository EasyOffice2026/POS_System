import type { AdminUser } from '@pos/shared';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../i18n/format';

// The state of an account: deactivated, locked or active. A table cell has no room to say until
// when a lock lasts, so there it is a tooltip. `detailed` writes it out.
export function StatusBadge({ user, detailed = false }: { user: AdminUser; detailed?: boolean }) {
  const { t, i18n } = useTranslation();

  if (!user.isActive) {
    return (
      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
        {t('users.status.inactive')}
      </span>
    );
  }
  if (user.lockedUntil) {
    const until = t('users.lockedUntil', { time: formatDateTime(user.lockedUntil, i18n.language) });

    return (
      <span
        title={until}
        className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800"
      >
        {detailed ? until : t('users.status.locked')}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
      {t('users.status.active')}
    </span>
  );
}
