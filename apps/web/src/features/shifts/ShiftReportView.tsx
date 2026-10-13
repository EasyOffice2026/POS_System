import type { ShiftReport, ShiftSummary } from '@pos/shared';
import { useTranslation } from 'react-i18next';
import { Price } from '../../components/Price';
import { formatDateTime } from '../../i18n/format';
import { localize } from '../../i18n/localize';

// The end-of-shift report, or the figures of a shift still open. See docs/specs/010-shifts.md,
// rule 8.
export function ShiftReportView({ shift }: { shift: ShiftSummary | (ShiftReport & object) }) {
  const { t, i18n } = useTranslation();
  const row = 'flex justify-between gap-3';
  const missing = shift.difference !== null && Number(shift.difference) < 0;
  const voids = 'voids' in shift ? shift.voids : null;

  return (
    <div className="space-y-4 text-sm" data-testid="shift-report">
      <dl className="space-y-1">
        <div className={row}>
          <dt className="text-slate-600">{t('shifts.openedBy')}</dt>
          <dd>
            {shift.openedByName} · {formatDateTime(shift.openedAt, i18n.language)}
          </dd>
        </div>
        {shift.closedAt && (
          <div className={row}>
            <dt className="text-slate-600">{t('shifts.closedBy')}</dt>
            <dd>
              {shift.closedByName} · {formatDateTime(shift.closedAt, i18n.language)}
            </dd>
          </div>
        )}
      </dl>

      <section className="space-y-1">
        <h3 className="font-semibold">{t('shifts.report.sales')}</h3>
        <dl className="space-y-1">
          <div className={row}>
            <dt>{t('shifts.report.ordersPaid')}</dt>
            <dd>{shift.figures.ordersPaid}</dd>
          </div>
          <div className={row}>
            <dt>{t('shifts.report.total')}</dt>
            <dd>
              <Price value={shift.figures.sales} />
            </dd>
          </div>
          <div className={row}>
            <dt>{t('shifts.report.discounts')}</dt>
            <dd>
              <Price value={shift.figures.discounts} />
            </dd>
          </div>
          {shift.figures.byMethod.map((entry) => (
            <div key={entry.method} className={`${row} ps-4 text-slate-700`}>
              <dt>{localize(entry.methodName, i18n.language)}</dt>
              <dd>
                <Price value={entry.amount} />
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {Number(shift.figures.refunds) > 0 && (
        <section className="space-y-1">
          <h3 className="font-semibold">{t('shifts.report.refunds')}</h3>
          <dl className="space-y-1">
            <div className={row}>
              <dt>{t('shifts.report.refundsTotal')}</dt>
              <dd data-testid="refunds-total">
                <Price value={shift.figures.refunds} />
              </dd>
            </div>
            {shift.figures.refundsByMethod.map((entry) => (
              <div key={entry.method} className={`${row} ps-4 text-slate-700`}>
                <dt>{localize(entry.methodName, i18n.language)}</dt>
                <dd>
                  <Price value={entry.amount} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="space-y-1">
        <h3 className="font-semibold">{t('shifts.report.drawer')}</h3>
        <dl className="space-y-1">
          <div className={row}>
            <dt>{t('shifts.openingCash')}</dt>
            <dd>
              <Price value={shift.openingCash} />
            </dd>
          </div>
          <div className={row}>
            <dt>{t('shifts.report.cashExpected')}</dt>
            <dd data-testid="cash-expected">
              <Price value={shift.expectedCash ?? shift.figures.cashExpected} />
            </dd>
          </div>
          {shift.countedCash !== null && (
            <div className={row}>
              <dt>{t('shifts.countedCash')}</dt>
              <dd>
                <Price value={shift.countedCash} />
              </dd>
            </div>
          )}
          {shift.difference !== null && (
            <div
              className={`${row} font-semibold ${missing ? 'text-red-700' : 'text-emerald-800'}`}
            >
              <dt>{t('shifts.difference')}</dt>
              <dd data-testid="difference">
                <Price value={shift.difference} />
              </dd>
            </div>
          )}
        </dl>
      </section>

      {voids && (
        <section className="space-y-1">
          <h3 className="font-semibold">{t('shifts.report.voids')}</h3>
          <dl className="space-y-1">
            <div className={row}>
              <dt>{t('shifts.report.voidedOrders', { count: voids.orders })}</dt>
              <dd>
                <Price value={voids.ordersValue} />
              </dd>
            </div>
            <div className={row}>
              <dt>{t('shifts.report.voidedLines', { count: voids.lines })}</dt>
              <dd>
                <Price value={voids.linesValue} />
              </dd>
            </div>
          </dl>
        </section>
      )}

      {shift.note && (
        <p className="text-slate-700">
          {t('shifts.note')}: {shift.note}
        </p>
      )}
    </div>
  );
}
