import { CASH, CASH_NAME, fromMils, type Order, toMils } from '@pos/shared';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { fieldClass, primaryButtonClass, secondaryButtonClass } from '../../components/form';
import { Price } from '../../components/Price';
import { localize } from '../../i18n/localize';
import { normalizeNumberInput } from '../../lib/numbers';
import type { RefundRequestInput } from './pos-api';

const amountText = /^\d{1,12}(\.\d{1,3})?$/;

interface RefundDialogProps {
  order: Order;
  onConfirm: (input: RefundRequestInput) => void;
  onCancel: () => void;
}

// Money back for a paid order: the amount (the rest of the order is offered), the way back
// (cash, or a way the order was paid with) and the reason. See docs/specs/011-refunds.md.
export function RefundDialog({ order, onConfirm, onCancel }: RefundDialogProps) {
  const { t, i18n } = useTranslation();
  const left = toMils(order.total) - toMils(order.refunded);
  // Made once, so the same refund sent again is given once (rule 7).
  const [id] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState(fromMils(left));
  const [method, setMethod] = useState(CASH);
  const [reason, setReason] = useState('');

  // Cash, then each way the order was paid with, once.
  const ways = [
    { key: CASH, name: CASH_NAME },
    ...order.payments
      .filter(
        (payment, index, all) =>
          payment.method !== CASH && all.findIndex((p) => p.method === payment.method) === index,
      )
      .map((payment) => ({ key: payment.method, name: payment.methodName })),
  ];

  const mils = amountText.test(amount.trim()) ? toMils(amount.trim()) : null;
  const ready = mils !== null && mils > 0 && mils <= left && reason.trim() !== '';

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (ready) onConfirm({ id, amount: amount.trim(), method, reason: reason.trim() });
  }

  return (
    <Dialog title={t('pos.refund.title', { number: order.number })} onClose={onCancel}>
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="flex items-center justify-between rounded-md bg-slate-50 p-3 text-sm">
          <span className="text-slate-600">{t('pos.refund.left')}</span>
          <span className="text-lg font-semibold" data-testid="refund-left">
            <Price value={fromMils(left)} />
          </span>
        </p>

        <label className="block text-sm font-medium text-slate-700">
          {t('pos.refund.amount')}
          <input
            type="text"
            inputMode="decimal"
            dir="ltr"
            autoComplete="off"
            value={amount}
            onChange={(event) => setAmount(normalizeNumberInput(event.target.value))}
            className={`${fieldClass} text-lg`}
          />
        </label>
        {mils !== null && mils > left && (
          <p role="alert" className="text-sm text-red-700">
            {t('pos.errors.REFUND_TOO_MUCH')}
          </p>
        )}

        <label className="block text-sm font-medium text-slate-700">
          {t('pos.refund.method')}
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            className={fieldClass}
          >
            {ways.map((way) => (
              <option key={way.key} value={way.key}>
                {localize(way.name, i18n.language)}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium text-slate-700">
          {t('pos.refund.reason')}
          <input
            type="text"
            dir="auto"
            maxLength={200}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={fieldClass}
          />
        </label>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={!ready} className={primaryButtonClass}>
            {t('pos.refund.confirm')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
