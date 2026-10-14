import type { SalesReport } from '@pos/shared';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { compactFieldClass, fieldClass, secondaryButtonClass } from '../../components/form';
import { Price } from '../../components/Price';
import { formatDate } from '../../i18n/format';
import { localize } from '../../i18n/localize';
import { messageFor, problemsFrom } from '../../lib/error-messages';
import { useAuth } from '../auth/auth-context';
import { useMenuBrand } from '../menu/use-menu-brand';
import { getSalesReport, reportKeys } from './reports-api';

// A day in the person's own time zone, as the API takes it ("2026-10-14").
const isoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return isoDay(date);
};

type Preset = 'today' | 'yesterday' | 'week' | 'month';
const presets: Record<Preset, () => { from: string; to: string }> = {
  today: () => ({ from: daysAgo(0), to: daysAgo(0) }),
  yesterday: () => ({ from: daysAgo(1), to: daysAgo(1) }),
  week: () => ({ from: daysAgo(6), to: daysAgo(0) }),
  month: () => {
    const now = new Date();
    return { from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDay(now) };
  },
};

// A table as a CSV file the person saves, for a spreadsheet.
function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const cell = (value: string | number | null) => {
    const text = value === null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  // The byte order mark lets Excel read the Arabic names.
  const BOM = String.fromCharCode(0xfeff);
  const blob = new Blob([`${BOM}${rows.map((row) => row.map(cell).join(',')).join('\n')}`], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function Figure({
  label,
  children,
  tone = '',
}: {
  label: string;
  children: ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone}`}>{children}</p>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

const th = 'py-2 pe-3 font-medium';
const td = 'py-2 pe-3 whitespace-nowrap';

// The sales report of a period, for a branch or every branch of a brand.
// See docs/specs/020-sales-reports.md.
export function ReportsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [, setSearchParams] = useSearchParams();
  const menuBrand = useMenuBrand();
  const chooseBrand = user?.brandId == null && menuBrand.brands.length > 1;
  const [range, setRange] = useState(presets.week);
  const [branchId, setBranchId] = useState('');
  const branch = menuBrand.branches.find((row) => row.id === branchId);
  const filter = {
    ...range,
    ...(branch ? { branchId: branch.id } : {}),
    ...(!branch && user?.scope === 'GROUP' && menuBrand.brandId
      ? { brandId: menuBrand.brandId }
      : {}),
  };

  const report = useQuery({
    queryKey: reportKeys.sales(filter),
    queryFn: () => getSalesReport(filter),
    enabled: user?.scope !== 'GROUP' || Boolean(menuBrand.brandId),
  });
  const problem = report.error ? (problemsFrom(report.error).fields.to ?? 'loadError') : null;
  const name = (text: { en: string; ar: string } | null) =>
    text ? localize(text, i18n.language) : t('reports.combos');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('reports.title')}</h1>

      <div className="flex flex-wrap items-end gap-3">
        {chooseBrand && (
          <label className="block text-sm font-medium text-slate-700">
            {t('reports.brand')}
            <select
              value={menuBrand.brandId ?? ''}
              onChange={(event) => {
                setBranchId('');
                setSearchParams({ brandId: event.target.value });
              }}
              className={fieldClass}
            >
              {menuBrand.brands.map((row) => (
                <option key={row.id} value={row.id}>
                  {localize(row.name, i18n.language)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-sm font-medium text-slate-700">
          {t('reports.branch')}
          <select
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
            className={fieldClass}
          >
            <option value="">{t('reports.allBranches')}</option>
            {menuBrand.branches.map((row) => (
              <option key={row.id} value={row.id}>
                {localize(row.name, i18n.language)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          {t('reports.from')}
          <input
            type="date"
            value={range.from}
            onChange={(event) => setRange({ ...range, from: event.target.value })}
            className={`${compactFieldClass} mt-1 block`}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          {t('reports.to')}
          <input
            type="date"
            value={range.to}
            onChange={(event) => setRange({ ...range, to: event.target.value })}
            className={`${compactFieldClass} mt-1 block`}
          />
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('reports.quick')}>
          {(Object.keys(presets) as Preset[]).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setRange(presets[preset]())}
              className={secondaryButtonClass}
            >
              {t(`reports.presets.${preset}`)}
            </button>
          ))}
        </div>
      </div>

      {report.isFetching && !report.data && (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      )}
      {problem && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {problem === 'loadError' ? t('common.loadError') : messageFor(problem, t)}
        </p>
      )}
      {report.data && !report.error && <Report report={report.data} name={name} />}
    </div>
  );
}

function Report({
  report,
  name,
}: {
  report: SalesReport;
  name: (text: { en: string; ar: string } | null) => string;
}) {
  const { t, i18n } = useTranslation();
  const { summary } = report;

  return (
    <div className="space-y-8">
      <p className="text-sm text-slate-600">
        {report.from === report.to
          ? formatDate(report.from, i18n.language)
          : t('reports.period', {
              from: formatDate(report.from, i18n.language),
              to: formatDate(report.to, i18n.language),
            })}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label={t('reports.summary')}>
        <Figure label={t('reports.orders')}>{summary.orders}</Figure>
        <Figure label={t('reports.grossSales')}>
          <Price value={summary.grossSales} />
        </Figure>
        <Figure label={t('reports.discounts')}>
          <Price value={summary.discounts} />
        </Figure>
        <Figure label={t('reports.netSales')}>
          <Price value={summary.netSales} />
        </Figure>
        <Figure label={t('reports.refunds')} tone="text-red-700">
          <Price value={summary.refunds} />
        </Figure>
        <Figure label={t('reports.netAfterRefunds')} tone="text-emerald-800">
          <Price value={summary.netAfterRefunds} />
        </Figure>
        <Figure label={t('reports.averageOrder')}>
          <Price value={summary.averageOrder} />
        </Figure>
        <Figure label={t('reports.voidedOrders')}>{summary.voidedOrders}</Figure>
      </div>

      <Section title={t('reports.byDay')}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-600">
              <th className={`${th} text-start`}>{t('reports.day')}</th>
              <th className={`${th} text-end`}>{t('reports.orders')}</th>
              <th className={`${th} text-end`}>{t('reports.netSales')}</th>
              <th className={`${th} text-end`}>{t('reports.refunds')}</th>
            </tr>
          </thead>
          <tbody>
            {report.days.map((row) => (
              <tr key={row.date} className="border-b border-slate-100">
                <td className={td}>{formatDate(row.date, i18n.language)}</td>
                <td className={`${td} text-end`}>{row.orders}</td>
                <td className={`${td} text-end`}>
                  <Price value={row.netSales} />
                </td>
                <td className={`${td} text-end`}>
                  <Price value={row.refunds} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={t('reports.byPayment')}>
        {report.payments.length === 0 ? (
          <p className="text-sm text-slate-500">{t('reports.nothing')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className={`${th} text-start`}>{t('reports.method')}</th>
                <th className={`${th} text-end`}>{t('reports.payments')}</th>
                <th className={`${th} text-end`}>{t('reports.amount')}</th>
                <th className={`${th} text-end`}>{t('reports.refunds')}</th>
              </tr>
            </thead>
            <tbody>
              {report.payments.map((row) => (
                <tr key={row.method} className="border-b border-slate-100">
                  <td className={td}>{name(row.name)}</td>
                  <td className={`${td} text-end`}>{row.count}</td>
                  <td className={`${td} text-end`}>
                    <Price value={row.amount} />
                  </td>
                  <td className={`${td} text-end`}>
                    <Price value={row.refunds} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section
        title={t('reports.byItem')}
        action={
          report.items.length > 0 && (
            <button
              type="button"
              onClick={() =>
                downloadCsv(`sales-by-item-${report.from}-${report.to}.csv`, [
                  [
                    t('reports.item'),
                    t('reports.quantity'),
                    t('reports.sales'),
                    t('reports.foodCost'),
                    t('reports.foodCostPercent'),
                  ],
                  ...report.items.map((row) => [
                    name(row.name),
                    row.quantity,
                    row.sales,
                    row.foodCost,
                    row.foodCostPercent,
                  ]),
                ])
              }
              className={secondaryButtonClass}
            >
              {t('reports.downloadCsv')}
            </button>
          )
        }
      >
        {report.items.length === 0 ? (
          <p className="text-sm text-slate-500">{t('reports.nothing')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className={`${th} text-start`}>{t('reports.item')}</th>
                <th className={`${th} text-end`}>{t('reports.quantity')}</th>
                <th className={`${th} text-end`}>{t('reports.sales')}</th>
                <th className={`${th} text-end`}>{t('reports.foodCost')}</th>
                <th className={`${th} text-end`}>{t('reports.foodCostPercent')}</th>
              </tr>
            </thead>
            <tbody>
              {report.items.map((row) => (
                <tr key={`${row.kind}-${row.id}`} className="border-b border-slate-100">
                  <td className={td}>
                    {name(row.name)}
                    {row.kind === 'combo' && (
                      <span className="ms-2 text-xs text-slate-500">{t('reports.combo')}</span>
                    )}
                  </td>
                  <td className={`${td} text-end`}>{row.quantity}</td>
                  <td className={`${td} text-end`}>
                    <Price value={row.sales} />
                  </td>
                  <td className={`${td} text-end`}>
                    {row.foodCost === null ? '–' : <Price value={row.foodCost} />}
                  </td>
                  <td className={`${td} text-end`}>
                    {row.foodCostPercent === null ? (
                      '–'
                    ) : (
                      <bdi dir="ltr">{row.foodCostPercent}%</bdi>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={t('reports.byCategory')}>
        {report.categories.length === 0 ? (
          <p className="text-sm text-slate-500">{t('reports.nothing')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className={`${th} text-start`}>{t('reports.category')}</th>
                <th className={`${th} text-end`}>{t('reports.quantity')}</th>
                <th className={`${th} text-end`}>{t('reports.sales')}</th>
              </tr>
            </thead>
            <tbody>
              {report.categories.map((row) => (
                <tr key={row.id ?? 'combos'} className="border-b border-slate-100">
                  <td className={td}>{name(row.name)}</td>
                  <td className={`${td} text-end`}>{row.quantity}</td>
                  <td className={`${td} text-end`}>
                    <Price value={row.sales} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
