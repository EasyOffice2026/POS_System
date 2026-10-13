import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { localize } from '../../i18n/localize';
import { alertKeys, listAlerts } from './inventory-api';

// The alerts are read again this often while the dashboard is open (spec 016).
export const ALERTS_REFRESH_MS = 5 * 60 * 1000;
const SHOWN = 5;

// What is out or low at each branch the person sees, on the dashboard.
// See docs/specs/016-stock-alerts.md.
export function StockAlertsPanel() {
  const { t, i18n } = useTranslation();
  const alerts = useQuery({
    queryKey: alertKeys.all,
    queryFn: listAlerts,
    refetchInterval: ALERTS_REFRESH_MS,
  });

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-base font-semibold text-slate-900">{t('alerts.title')}</h2>
      {alerts.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {alerts.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('dashboard.loadError')}
        </p>
      )}
      {alerts.data?.length === 0 && <p className="text-sm text-emerald-800">{t('alerts.none')}</p>}
      <ul className="space-y-4">
        {alerts.data?.map(({ branch, items }) => {
          const name = localize(branch.name, i18n.language);
          const out = items.filter((item) => item.status === 'out').length;
          const search = new URLSearchParams({
            brandId: branch.brandId,
            branchId: branch.id,
            low: '1',
          });
          return (
            <li key={branch.id} aria-label={name}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">{name}</h3>
                <p className="text-xs text-slate-600">
                  {t('alerts.counts', { out, low: items.length - out })}
                </p>
              </div>
              <ul className="mt-1 divide-y divide-slate-100 text-sm">
                {items.slice(0, SHOWN).map((item) => (
                  <li
                    key={item.ingredient.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-1"
                  >
                    <span>
                      <span
                        className={`me-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                          item.status === 'out'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {t(`alerts.status.${item.status}`)}
                      </span>
                      {localize(item.ingredient.name, i18n.language)}
                    </span>
                    <span className="text-xs whitespace-nowrap text-slate-600">
                      {t('alerts.level', {
                        quantity: item.quantity,
                        level: item.level,
                        unit: t(`inventory.units.${item.ingredient.unit}`),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
              <Link
                to={`/admin/inventory/stock?${search.toString()}`}
                aria-label={t('alerts.seeAllFor', { name })}
                className="mt-1 inline-block text-xs text-slate-600 underline"
              >
                {items.length > SHOWN
                  ? t('alerts.seeMore', { count: items.length - SHOWN })
                  : t('alerts.seeAll')}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
