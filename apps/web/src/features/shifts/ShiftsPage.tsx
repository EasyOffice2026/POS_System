import type { Branch, ShiftStatus, ShiftSummary } from '@pos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { Dialog } from '../../components/Dialog';
import { fieldClass, secondaryButtonClass } from '../../components/form';
import { Price } from '../../components/Price';
import { formatDateTime } from '../../i18n/format';
import { localize } from '../../i18n/localize';
import { useDirectory } from '../admin/use-directory';
import { useAuth } from '../auth/auth-context';
import { CloseShiftDialog } from './ShiftGate';
import { ShiftReportView } from './ShiftReportView';
import { getShift, listShifts, shiftKeys } from './shifts-api';

// The shifts of a branch for a manager, newest first, open ones first, with a report for each and
// a way to close one a cashier forgot. See docs/specs/010-shifts.md, rules 7 and 9.
export function ShiftsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { branches, isLoading, isError } = useDirectory();

  const requested = searchParams.get('branchId');
  const branchId =
    branches.find((branch) => branch.id === requested)?.id ?? branches[0]?.id ?? null;
  const statusParam = searchParams.get('status');
  const status: ShiftStatus | undefined =
    statusParam === 'open' || statusParam === 'closed' ? statusParam : undefined;
  const [reportId, setReportId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const canClose = user?.permissions.includes('orders:write') ?? false;

  const shifts = useQuery({
    queryKey: shiftKeys.list(branchId ?? '', status),
    queryFn: () => listShifts(branchId ?? '', status),
    enabled: Boolean(branchId),
  });
  const report = useQuery({
    queryKey: shiftKeys.one(reportId ?? ''),
    queryFn: () => getShift(reportId ?? ''),
    enabled: Boolean(reportId),
  });

  const setParam = (name: string, value: string) =>
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(name, value);
      else next.delete(name);
      return next;
    });
  const label = (branch: Branch) => localize(branch.name, i18n.language);
  const closing = shifts.data?.data.find((shift) => shift.id === closingId);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('shifts.title')}</h1>
      <p className="text-sm text-slate-600">{t('shifts.intro')}</p>

      {isLoading && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}

      {branches.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <label className="block text-sm font-medium text-slate-700">
            {t('shifts.branch')}
            <select
              value={branchId ?? ''}
              onChange={(event) => setParam('branchId', event.target.value)}
              className={fieldClass}
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {label(branch)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            {t('shifts.status')}
            <select
              value={status ?? ''}
              onChange={(event) => setParam('status', event.target.value)}
              className={fieldClass}
            >
              <option value="">{t('common.all')}</option>
              <option value="open">{t('shifts.statuses.open')}</option>
              <option value="closed">{t('shifts.statuses.closed')}</option>
            </select>
          </label>
        </div>
      )}

      {shifts.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {shifts.data?.data.length === 0 && (
        <p className="text-sm text-slate-500">{t('shifts.empty')}</p>
      )}

      {shifts.data && shifts.data.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-start text-slate-600">
                <th className="py-2 pe-3 text-start font-medium">{t('shifts.openedBy')}</th>
                <th className="py-2 pe-3 text-start font-medium">{t('shifts.status')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('shifts.report.total')}</th>
                <th className="py-2 pe-3 text-end font-medium">
                  {t('shifts.report.cashExpected')}
                </th>
                <th className="py-2 pe-3 text-end font-medium">{t('shifts.countedCash')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('shifts.difference')}</th>
                <th className="py-2 text-end font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {shifts.data.data.map((shift: ShiftSummary) => (
                <tr key={shift.id} className="border-b border-slate-100">
                  <td className="py-2 pe-3">
                    <p className="font-medium">{shift.openedByName}</p>
                    <p className="text-xs text-slate-500">
                      {formatDateTime(shift.openedAt, i18n.language)}
                      {shift.closedAt && ` – ${formatDateTime(shift.closedAt, i18n.language)}`}
                    </p>
                  </td>
                  <td className="py-2 pe-3">{t(`shifts.statuses.${shift.status}`)}</td>
                  <td className="py-2 pe-3 text-end">
                    <Price value={shift.figures.sales} />
                  </td>
                  <td className="py-2 pe-3 text-end">
                    <Price value={shift.expectedCash ?? shift.figures.cashExpected} />
                  </td>
                  <td className="py-2 pe-3 text-end">
                    {shift.countedCash ? <Price value={shift.countedCash} /> : '–'}
                  </td>
                  <td
                    className={`py-2 pe-3 text-end font-medium ${
                      shift.difference && Number(shift.difference) < 0 ? 'text-red-700' : ''
                    }`}
                  >
                    {shift.difference ? <Price value={shift.difference} /> : '–'}
                  </td>
                  <td className="py-2 text-end whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setReportId(shift.id)}
                      className="inline-flex min-h-9 items-center rounded-md px-2.5 font-medium text-slate-700 hover:bg-slate-100"
                      aria-label={`${t('shifts.report.title')}: ${shift.openedByName}`}
                    >
                      {t('shifts.report.title')}
                    </button>
                    {shift.status === 'open' && canClose && (
                      <button
                        type="button"
                        onClick={() => setClosingId(shift.id)}
                        className="ms-1 inline-flex min-h-9 items-center rounded-md px-2.5 font-medium text-red-700 hover:bg-red-50"
                        aria-label={`${t('shifts.close.title')}: ${shift.openedByName}`}
                      >
                        {t('shifts.close.title')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reportId && (
        <Dialog title={t('shifts.report.title')} onClose={() => setReportId(null)}>
          {report.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
          {report.isError && (
            <p role="alert" className="text-sm text-red-700">
              {t('common.loadError')}
            </p>
          )}
          {report.data && <ShiftReportView shift={report.data} />}
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => setReportId(null)}
              className={secondaryButtonClass}
            >
              {t('common.back')}
            </button>
          </div>
        </Dialog>
      )}

      {closing && (
        <CloseShiftDialog
          shift={closing}
          onCancel={() => setClosingId(null)}
          onClosed={() => {
            setClosingId(null);
            void queryClient.invalidateQueries({ queryKey: shiftKeys.all });
          }}
        />
      )}
    </div>
  );
}
