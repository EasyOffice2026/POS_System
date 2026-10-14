import type { Order } from '@pos/shared';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { primaryButtonClass, secondaryButtonClass } from '../../components/form';
import { Price } from '../../components/Price';
import { formatDateTime } from '../../i18n/format';
import { localize } from '../../i18n/localize';
import type { Terminal } from './terminal-store';

interface ReceiptProps {
  order: Order;
  terminal: Terminal;
  cashier: string;
  // The bill of an order not paid yet, printed for the table (docs/specs/023-floor-plan.md).
  bill?: boolean;
}

// What was sold and how it was paid. It shows no tax until the VAT decision is made, and nothing
// it cannot back up. See docs/specs/007-payments.md, rule 9.
export function Receipt({ order, terminal, cashier, bill = false }: ReceiptProps) {
  const { t, i18n } = useTranslation();
  const names = (modifiers: Order['lines'][number]['modifiers']) =>
    modifiers.map((modifier) => localize(modifier.name, i18n.language)).join(', ');
  const row = 'flex justify-between gap-3';

  return (
    <div className="mx-auto max-w-xs space-y-3 text-sm text-slate-900" data-testid="receipt">
      <div className="text-center">
        {terminal.brandName && (
          <p className="font-semibold">{localize(terminal.brandName, i18n.language)}</p>
        )}
        <p>{localize(terminal.branchName, i18n.language)}</p>
        <p className="mt-1 text-lg font-semibold">
          {t('pos.order.number', { number: order.number })}
        </p>
        <p className="text-xs text-slate-600">
          {t(`pos.order.types.${order.type}`)}
          {order.table && ` · ${t('pos.table.name', { name: order.table.name })}`} ·{' '}
          {formatDateTime(
            bill ? (order.billPrintedAt ?? order.updatedAt) : (order.paidAt ?? order.updatedAt),
            i18n.language,
          )}
        </p>
        {bill && <p className="mt-1 font-semibold uppercase">{t('pos.table.notPaid')}</p>}
        <p className="text-xs text-slate-600">{t('pos.receipt.cashier', { name: cashier })}</p>
        {order.customer && (
          <p className="text-xs text-slate-600">
            {t('pos.receipt.customer')} {order.customer.name && <bdi>{order.customer.name}</bdi>}{' '}
            <bdi dir="ltr">{order.customer.phone}</bdi>
          </p>
        )}
      </div>

      <ul className="space-y-1 border-y border-dashed border-slate-300 py-2">
        {order.lines
          .filter((line) => line.status !== 'voided')
          .map((line) => (
            <li key={line.id}>
              <div className={row}>
                <span>
                  {line.quantity} × {localize(line.name, i18n.language)}
                </span>
                <Price value={line.lineTotal} />
              </div>
              {line.modifiers.length > 0 && (
                <p className="ps-4 text-xs text-slate-600">{names(line.modifiers)}</p>
              )}
              {line.choices.map((choice) => (
                <p key={choice.slotId} className="ps-4 text-xs text-slate-600">
                  {localize(choice.name, i18n.language)}
                  {choice.modifiers.length > 0 && ` (${names(choice.modifiers)})`}
                </p>
              ))}
            </li>
          ))}
      </ul>

      <dl className="space-y-1">
        <div className={row}>
          <dt>{t('pos.order.subtotal')}</dt>
          <dd>
            <Price value={order.subtotal} />
          </dd>
        </div>
        {order.promotions.map((promotion) => (
          <div key={promotion.id} className={row}>
            <dt>{localize(promotion.name, i18n.language)}</dt>
            <dd>
              − <Price value={promotion.amount} />
            </dd>
          </div>
        ))}
        {order.discount && (
          <div className={row}>
            <dt>{t('pos.order.discount')}</dt>
            <dd>
              − <Price value={order.discount.amount} />
            </dd>
          </div>
        )}
        {order.pointsRedeemed > 0 && (
          <div className={row}>
            <dt>{t('pos.points.row', { count: order.pointsRedeemed })}</dt>
            <dd>
              − <Price value={order.pointsDiscount} />
            </dd>
          </div>
        )}
        <div className={`${row} text-base font-semibold`}>
          <dt>{t('pos.order.total')}</dt>
          <dd>
            <Price value={order.total} />
          </dd>
        </div>
      </dl>

      {!bill && order.payments.length > 0 && (
        <dl className="space-y-1 border-t border-dashed border-slate-300 pt-2">
          {order.payments.map((payment) => (
            <div key={payment.id}>
              <div className={row}>
                <dt>
                  {localize(payment.methodName, i18n.language)}
                  {payment.reference && (
                    <span className="text-xs text-slate-600">
                      {' '}
                      ({t('pos.receipt.slip')} <bdi dir="ltr">{payment.reference}</bdi>)
                    </span>
                  )}
                </dt>
                <dd>
                  <Price value={payment.tendered ?? payment.amount} />
                </dd>
              </div>
            </div>
          ))}
          {order.change !== '0.000' && (
            <div className={`${row} font-semibold`}>
              <dt>{t('pos.pay.change')}</dt>
              <dd>
                <Price value={order.change} />
              </dd>
            </div>
          )}
        </dl>
      )}

      {!bill && order.customer && (order.pointsEarned > 0 || order.pointsRedeemed > 0) && (
        <dl className="space-y-1 border-t border-dashed border-slate-300 pt-2 text-xs">
          {order.pointsEarned > 0 && (
            <div className={row}>
              <dt>{t('pos.points.earned')}</dt>
              <dd>{t('pos.customer.points', { count: order.pointsEarned })}</dd>
            </div>
          )}
          <div className={row}>
            <dt>{t('pos.points.newBalance')}</dt>
            <dd>{t('pos.customer.points', { count: order.customer.points })}</dd>
          </div>
        </dl>
      )}

      <p className="pt-2 text-center text-xs text-slate-600">
        {bill ? t('pos.table.billThanks') : t('pos.receipt.thanks')}
      </p>
    </div>
  );
}

interface ReceiptDialogProps extends ReceiptProps {
  onNewOrder: () => void;
  onClose: () => void;
}

interface BillDialogProps extends ReceiptProps {
  onClose: () => void;
}

// The bill of a table before it pays, with a button to print it (spec 023, rule 6).
export function BillDialog({ onClose, ...receipt }: BillDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog title={t('pos.table.billTitle')} onClose={onClose}>
      <Receipt {...receipt} bill />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={secondaryButtonClass}>
          {t('common.back')}
        </button>
        <button type="button" onClick={() => window.print()} className={primaryButtonClass}>
          {t('pos.receipt.print')}
        </button>
      </div>
    </Dialog>
  );
}

// The receipt after payment, with a button to print it on any printer the browser knows.
export function ReceiptDialog({ onNewOrder, onClose, ...receipt }: ReceiptDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog title={t('pos.receipt.title')} onClose={onClose}>
      <Receipt {...receipt} />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={() => window.print()} className={secondaryButtonClass}>
          {t('pos.receipt.print')}
        </button>
        <button type="button" onClick={onNewOrder} className={primaryButtonClass}>
          {t('pos.order.newOrder')}
        </button>
      </div>
    </Dialog>
  );
}
