import { useTranslation } from 'react-i18next';

// Whether a brand or a branch is active. An inactive one keeps its history but is not in use.
export function ActiveBadge({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();

  return isActive ? (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
      {t('common.statusActive')}
    </span>
  ) : (
    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
      {t('common.statusInactive')}
    </span>
  );
}
