import { type Overview, type OverviewAttention, toMils } from '@pos/shared';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { fieldClass } from '../../components/form';
import { Price } from '../../components/Price';
import { formatDateTime } from '../../i18n/format';
import { localize } from '../../i18n/localize';
import { useAuth } from '../auth/auth-context';
import { getOverview, overviewKeys } from './admin-api';
import { useDirectory } from './use-directory';

// How often the overview is asked for again (docs/specs/024-group-dashboard.md, rule 9).
export const OVERVIEW_REFRESH_MS = 60_000;

const cardClass = 'rounded-lg border border-slate-200 bg-white p-4';

// The change against last week, as a whole percentage, or null when last week had nothing.
export function changeAgainst(now: number, before: number): number | null {
  if (before === 0) return null;
  // Halves round away from zero, so a fall and a rise of the same size read the same.
  const change = ((now - before) / before) * 100;
  return Math.sign(change) * Math.round(Math.abs(change));
}

function Change({ now, before }: { now: number; before: number }) {
  const { t } = useTranslation();
  const change = changeAgainst(now, before);
  if (change === null) {
    return <p className="text-xs text-slate-500">{t('overview.noLastWeek')}</p>;
  }
  const tone = change > 0 ? 'text-emerald-700' : change < 0 ? 'text-red-700' : 'text-slate-600';
  return (
    <p className={`text-xs font-medium ${tone}`}>
      <bdi dir="ltr">{change > 0 ? `+${change}%` : `${change}%`}</bdi> {t('overview.onLastWeek')}
    </p>
  );
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={cardClass}>
      <p className="text-xs text-slate-500">{label}</p>
      <div className="mt-1 text-xl font-semibold">{children}</div>
    </div>
  );
}

// Sales by hour as bars, with the figures written out for screen readers (rule 6).
function HourChart({ hours }: { hours: Overview['hours'] }) {
  const { t } = useTranslation();
  const busy = hours.filter((slot) => slot.orders > 0);
  if (busy.length === 0) return <p className="text-sm text-slate-500">{t('overview.noSales')}</p>;
  const first = Math.min(...busy.map((slot) => slot.hour));
  const last = Math.max(...busy.map((slot) => slot.hour));
  const shown = hours.filter((slot) => slot.hour >= first && slot.hour <= last);
  const most = Math.max(...shown.map((slot) => toMils(slot.sales)), 1);
  const hourText = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

  return (
    <ol className="flex h-40 items-end gap-1" dir="ltr" aria-label={t('overview.byHour')}>
      {shown.map((slot) => (
        <li key={slot.hour} className="flex h-full min-w-0 flex-1 flex-col justify-end">
          <span className="sr-only">
            {hourText(slot.hour)}: {slot.sales} {t('menu.currency')},{' '}
            {t('overview.orders', { count: slot.orders })}
          </span>
          <span
            aria-hidden="true"
            title={`${hourText(slot.hour)} · ${slot.sales}`}
            className="w-full rounded-t bg-emerald-600"
            style={{
              height: `${Math.max((toMils(slot.sales) / most) * 100, slot.orders > 0 ? 3 : 0)}%`,
            }}
          />
          <span aria-hidden="true" className="mt-1 text-center text-[10px] text-slate-500">
            {slot.hour}
          </span>
        </li>
      ))}
    </ol>
  );
}

function AttentionRow({ row, overview }: { row: OverviewAttention; overview: Overview }) {
  const { t, i18n } = useTranslation();
  const branch = overview.branches.find((item) => item.id === row.branchId);
  const where = branch ? localize(branch.name, i18n.language) : '';
  if (row.kind === 'old_shift') {
    return (
      <li className="text-sm">
        <span className="font-medium">{where}:</span>{' '}
        {t('overview.attention.oldShift', {
          name: row.name ?? '',
          since: row.since ? formatDateTime(row.since, i18n.language) : '',
        })}{' '}
        <Link to="/admin/shifts" className="underline">
          {t('overview.attention.seeShifts')}
        </Link>
      </li>
    );
  }
  return (
    <li className="text-sm">
      <span className="font-medium">{where}:</span>{' '}
      {row.kind === 'voids'
        ? t('overview.attention.voids', { count: row.count })
        : t('overview.attention.refunds', { count: row.count })}{' '}
      <Price value={row.amount} />
    </li>
  );
}

// Today at every branch the person sees: the figures, the branches, the busy hours, the dishes
// that sell, and what needs a manager. See docs/specs/024-group-dashboard.md.
export function GroupOverview() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const directory = useDirectory();
  const [brandId, setBrandId] = useState('');
  const chooseBrand = user?.scope === 'GROUP' && directory.brands.length > 1;
  const overview = useQuery({
    queryKey: overviewKeys.today(brandId),
    queryFn: () => getOverview(brandId),
    refetchInterval: OVERVIEW_REFRESH_MS,
  });
  const data = overview.data;
  const time = new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-u-nu-latn' : 'en-GB', {
    timeStyle: 'short',
    hourCycle: 'h23',
  });

  return (
    <section aria-labelledby="overview-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="overview-title" className="text-xl font-semibold">
            {t('overview.title')}
          </h2>
          {data && (
            <p className="text-xs text-slate-500">
              {t('overview.updated', { time: time.format(new Date(data.generatedAt)) })}
            </p>
          )}
        </div>
        {chooseBrand && (
          <label className="block text-sm font-medium text-slate-700">
            {t('settings.brand')}
            <select
              value={brandId}
              onChange={(event) => setBrandId(event.target.value)}
              className={fieldClass}
            >
              <option value="">{t('overview.allBrands')}</option>
              {directory.brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {localize(brand.name, i18n.language)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {overview.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {overview.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Figure label={t('overview.sales')}>
              <Price value={data.summary.sales} />
              <Change
                now={toMils(data.summary.sales)}
                before={toMils(data.summary.lastWeekSales)}
              />
            </Figure>
            <Figure label={t('overview.ordersLabel')}>
              {data.summary.orders}
              <Change now={data.summary.orders} before={data.summary.lastWeekOrders} />
            </Figure>
            <Figure label={t('overview.average')}>
              <Price value={data.summary.averageOrder} />
            </Figure>
            <Figure label={t('overview.discounts')}>
              <Price value={data.summary.discounts} />
            </Figure>
            <Figure label={t('overview.refunds')}>
              <Price value={data.summary.refunds} />
              <p className="text-xs font-normal text-slate-500">
                {t('overview.voided', { count: data.summary.voidedOrders })}
              </p>
            </Figure>
          </div>

          <div className={`${cardClass} overflow-x-auto p-0`}>
            <table className="w-full min-w-[42rem] text-sm">
              <caption className="px-4 pt-3 text-start text-base font-semibold">
                {t('overview.branches')}
              </caption>
              <thead className="text-xs text-slate-600">
                <tr>
                  <th className="px-4 py-2 text-start font-medium">{t('overview.branch')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('overview.sales')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('overview.lastWeek')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('overview.ordersLabel')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('overview.open')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('overview.tables')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('overview.shifts')}</th>
                </tr>
              </thead>
              <tbody>
                {data.branches.map((branch) => (
                  <tr key={branch.id} className="border-t border-slate-100">
                    <td className="px-4 py-2">
                      <p className="font-medium whitespace-nowrap">
                        {localize(branch.name, i18n.language)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {localize(branch.brandName, i18n.language)}
                      </p>
                    </td>
                    <td className="px-4 py-2 text-end">
                      <Price value={branch.sales} />
                    </td>
                    <td className="px-4 py-2 text-end text-slate-600">
                      <Price value={branch.lastWeekSales} />
                    </td>
                    <td className="px-4 py-2 text-end">{branch.orders}</td>
                    <td className="px-4 py-2 text-end whitespace-nowrap">
                      {branch.openOrders}
                      {branch.openOrders > 0 && (
                        <span className="text-xs text-slate-500">
                          {' · '}
                          <Price value={branch.openTotal} />
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-end">
                      {branch.tables > 0 ? (
                        <bdi dir="ltr">
                          {branch.tablesInUse} / {branch.tables}
                        </bdi>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-2 text-end">{branch.openShifts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.branches.length === 0 && (
              <p className="px-4 pb-3 text-sm text-slate-500">{t('dashboard.noBranches')}</p>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className={cardClass}>
              <h3 className="mb-3 text-base font-semibold">{t('overview.byHour')}</h3>
              <HourChart hours={data.hours} />
            </div>
            <div className={cardClass}>
              <h3 className="mb-3 text-base font-semibold">{t('overview.topItems')}</h3>
              {data.topItems.length === 0 ? (
                <p className="text-sm text-slate-500">{t('overview.noSales')}</p>
              ) : (
                <ol className="space-y-1 text-sm">
                  {data.topItems.map((item, index) => (
                    <li key={`${item.kind}-${item.id}`} className="flex justify-between gap-3">
                      <span className="min-w-0">
                        <span className="text-slate-500">{index + 1}.</span>{' '}
                        {localize(item.name, i18n.language)}{' '}
                        <span className="text-slate-500">× {item.quantity}</span>
                      </span>
                      <Price value={item.sales} />
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>

          <div className={cardClass}>
            <h3 className="mb-3 text-base font-semibold">{t('overview.voids.title')}</h3>
            {data.voids.length === 0 ? (
              <p className="text-sm text-slate-500">{t('overview.voids.none')}</p>
            ) : (
              <table className="w-full text-sm" aria-label={t('overview.voids.title')}>
                <thead className="text-xs text-slate-600">
                  <tr>
                    <th className="py-1 text-start font-medium">{t('overview.voids.reason')}</th>
                    <th className="py-1 text-end font-medium">{t('overview.voids.orders')}</th>
                    <th className="py-1 text-end font-medium">{t('overview.voids.lines')}</th>
                    <th className="py-1 text-end font-medium">{t('overview.voids.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.voids.map((row) => (
                    <tr key={row.reason} className="border-t border-slate-100">
                      <td className="py-1">
                        {row.reason ? <bdi>{row.reason}</bdi> : t('overview.voids.noReason')}
                      </td>
                      <td className="py-1 text-end">{row.orders}</td>
                      <td className="py-1 text-end">{row.lines}</td>
                      <td className="py-1 text-end">
                        <Price value={row.amount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className={cardClass}>
            <h3 className="mb-3 text-base font-semibold">{t('overview.attention.title')}</h3>
            {data.attention.length === 0 ? (
              <p className="text-sm text-slate-500">{t('overview.attention.none')}</p>
            ) : (
              <ul className="space-y-2">
                {data.attention.map((row) => (
                  <AttentionRow
                    key={`${row.kind}-${row.branchId}-${row.since ?? ''}`}
                    row={row}
                    overview={data}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
