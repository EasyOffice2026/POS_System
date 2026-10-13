import { fromMils, type Order, toMils } from '@pos/shared';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { fieldClass, primaryButtonClass, secondaryButtonClass } from '../../components/form';
import { Price } from '../../components/Price';
import { normalizeNumberInput } from '../../lib/numbers';
import type { TenderInput } from './pos-api';

type Mode = 'cash' | 'card' | 'split';

// Banknotes offered as quick buttons when they cover what is due.
const notes = [10, 20, 50, 100, 200, 500];

const amountText = /^\d{1,12}(\.\d{1,3})?$/;
const milsOf = (text: string) => (amountText.test(text.trim()) ? toMils(text.trim()) : null);

interface PaymentDialogProps {
  order: Order;
  // Sends the payment. The dialog closes when it is done, whether it worked or not.
  onPay: (tenders: TenderInput[]) => void;
  onCancel: () => void;
}

// Takes the money for the whole order: in cash with the change shown, by card (recorded by hand
// until a card provider is chosen), or part by card and the rest in cash.
// See docs/specs/007-payments.md, rules 1 to 3.
export function PaymentDialog({ order, onPay, onCancel }: PaymentDialogProps) {
  const { t } = useTranslation();
  // Made once, so the same payment sent again is recognised (spec 007, rule 7).
  const [ids] = useState(() => ({ cash: crypto.randomUUID(), card: crypto.randomUUID() }));
  const [mode, setMode] = useState<Mode>('cash');
  const [tendered, setTendered] = useState('');
  const [cardAmount, setCardAmount] = useState('');
  const [reference, setReference] = useState('');

  const due = toMils(order.total);
  const cardPart = mode === 'card' ? due : mode === 'split' ? milsOf(cardAmount) : 0;
  const cashPart = cardPart === null ? null : due - cardPart;
  const handed = milsOf(tendered);

  // What is wrong with the payment as typed, or null when it can be sent.
  let ready = cardPart !== null && cashPart !== null && cashPart >= 0;
  if (mode === 'split' && (cardPart === null || cardPart <= 0 || cardPart > due)) ready = false;
  if (cashPart !== null && cashPart > 0 && (handed === null || handed < cashPart)) ready = false;
  const change = ready && cashPart && handed !== null ? handed - cashPart : 0;

  function tenders(): TenderInput[] {
    const parts: TenderInput[] = [];
    if (cardPart && cardPart > 0) {
      parts.push({
        id: ids.card,
        method: 'card',
        amount: fromMils(cardPart),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
    }
    if (cashPart && cashPart > 0 && handed !== null) {
      parts.push({
        id: ids.cash,
        method: 'cash',
        amount: fromMils(cashPart),
        tendered: fromMils(handed),
      });
    }
    return parts;
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (ready) onPay(tenders());
  }

  const tab = (key: Mode) => (
    <button
      type="button"
      aria-pressed={mode === key}
      onClick={() => {
        setMode(key);
        setTendered('');
      }}
      className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${
        mode === key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }`}
    >
      {t(`pos.pay.modes.${key}`)}
    </button>
  );

  const cashFields = cashPart !== null && cashPart > 0 && (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-slate-700">
        {mode === 'split'
          ? t('pos.pay.tenderedRest', { amount: fromMils(cashPart) })
          : t('pos.pay.tendered')}
        <input
          type="text"
          inputMode="decimal"
          dir="ltr"
          autoComplete="off"
          value={tendered}
          onChange={(event) => setTendered(normalizeNumberInput(event.target.value))}
          className={`${fieldClass} text-lg`}
        />
      </label>
      <div className="flex flex-wrap gap-2" dir="ltr">
        <button
          type="button"
          onClick={() => setTendered(fromMils(cashPart))}
          className={secondaryButtonClass}
        >
          {t('pos.pay.exact')}
        </button>
        {notes
          .filter((note) => note * 1000 > cashPart)
          .slice(0, 4)
          .map((note) => (
            <button
              key={note}
              type="button"
              onClick={() => setTendered(String(note))}
              className={secondaryButtonClass}
            >
              {note}
            </button>
          ))}
      </div>
    </div>
  );

  const referenceField = (
    <label className="block text-sm font-medium text-slate-700">
      {t('pos.pay.reference')}
      <input
        type="text"
        dir="ltr"
        maxLength={40}
        autoComplete="off"
        value={reference}
        onChange={(event) => setReference(event.target.value)}
        className={fieldClass}
      />
    </label>
  );

  return (
    <Dialog title={t('pos.pay.title', { number: order.number })} onClose={onCancel}>
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="flex items-center justify-between rounded-md bg-slate-50 p-3">
          <span className="text-sm text-slate-600">{t('pos.pay.due')}</span>
          <span className="text-2xl font-semibold" data-testid="amount-due">
            <Price value={order.total} />
          </span>
        </p>

        {due > 0 && (
          <div className="flex gap-2">
            {tab('cash')}
            {tab('card')}
            {tab('split')}
          </div>
        )}

        {due > 0 && mode === 'cash' && cashFields}
        {due > 0 && mode === 'card' && (
          <>
            <p className="text-sm text-slate-600">{t('pos.pay.cardHint')}</p>
            {referenceField}
          </>
        )}
        {due > 0 && mode === 'split' && (
          <>
            <label className="block text-sm font-medium text-slate-700">
              {t('pos.pay.cardAmount')}
              <input
                type="text"
                inputMode="decimal"
                dir="ltr"
                autoComplete="off"
                value={cardAmount}
                onChange={(event) => setCardAmount(normalizeNumberInput(event.target.value))}
                className={fieldClass}
              />
            </label>
            {referenceField}
            {cashFields}
          </>
        )}
        {due === 0 && <p className="text-sm text-slate-600">{t('pos.pay.nothingDue')}</p>}

        {cashPart !== null && cashPart > 0 && (
          <p className="flex items-center justify-between rounded-md bg-emerald-50 p-3 text-emerald-900">
            <span className="text-sm">{t('pos.pay.change')}</span>
            <span className="text-xl font-semibold" data-testid="change-due">
              <Price value={fromMils(change)} />
            </span>
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={!ready} className={`${primaryButtonClass} px-6`}>
            {due === 0 ? t('pos.pay.close') : t('pos.pay.confirm')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
