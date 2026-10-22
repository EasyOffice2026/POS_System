import {
  activePaymentMethods,
  type BrandSettings,
  CASH,
  fromMils,
  type Order,
  toMils,
} from '@pos/shared';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { Banknote, CreditCard, Split } from 'lucide-react';
import { fieldClass, moneyButtonClass, secondaryButtonClass } from '../../components/form';
import { Price } from '../../components/Price';
import { localize } from '../../i18n/localize';
import { normalizeNumberInput } from '../../lib/numbers';
import type { TenderInput } from './pos-api';

// Cash alone, one other way to pay alone, or that way and the rest in cash.
type Mode = 'cash' | 'method' | 'mixed';

// Banknotes offered as quick buttons when they cover what is due.
const notes = [1, 5, 10, 20, 50, 100];

const amountText = /^\d{1,12}(\.\d{1,3})?$/;
const milsOf = (text: string) => (amountText.test(text.trim()) ? toMils(text.trim()) : null);

interface PaymentDialogProps {
  order: Order;
  // The ways to pay of the brand (spec 009, rule 2).
  settings: BrandSettings;
  // Sends the payment. The dialog closes when it is done, whether it worked or not.
  onPay: (tenders: TenderInput[]) => void;
  onCancel: () => void;
}

// Takes the money for the whole order: in cash with the change shown, by one of the brand's ways
// to pay (KNET, Link, a delivery platform), or part by one of them and the rest in cash.
// See docs/specs/007-payments.md, rules 1 to 3.
export function PaymentDialog({ order, settings, onPay, onCancel }: PaymentDialogProps) {
  const { t, i18n } = useTranslation();
  const methods = activePaymentMethods(settings);
  // Made once, so the same payment sent again is recognised (spec 007, rule 7).
  const [ids] = useState(() => ({ cash: crypto.randomUUID(), other: crypto.randomUUID() }));
  const [mode, setMode] = useState<Mode>('cash');
  const [methodKey, setMethodKey] = useState(methods[0]?.key ?? '');
  const [tendered, setTendered] = useState('');
  const [methodAmount, setMethodAmount] = useState('');
  const [reference, setReference] = useState('');

  const method = methods.find((candidate) => candidate.key === methodKey);
  const methodName = method ? localize(method.name, i18n.language) : '';
  const due = toMils(order.total);
  const otherPart = mode === 'method' ? due : mode === 'mixed' ? milsOf(methodAmount) : 0;
  const cashPart = otherPart === null ? null : due - otherPart;
  const handed = milsOf(tendered);

  let ready = otherPart !== null && cashPart !== null && cashPart >= 0;
  if (mode !== 'cash' && !method) ready = false;
  if (mode === 'mixed' && (otherPart === null || otherPart <= 0 || otherPart > due)) ready = false;
  if (cashPart !== null && cashPart > 0 && (handed === null || handed < cashPart)) ready = false;
  // A KNET or platform payment carries its slip or transaction number.
  if (otherPart !== null && otherPart > 0 && reference.trim() === '') ready = false;
  const change = ready && cashPart && handed !== null ? handed - cashPart : 0;

  function tenders(): TenderInput[] {
    const parts: TenderInput[] = [];
    if (method && otherPart && otherPart > 0) {
      parts.push({
        id: ids.other,
        method: method.key,
        amount: fromMils(otherPart),
        reference: reference.trim(),
      });
    }
    if (cashPart && cashPart > 0 && handed !== null) {
      parts.push({
        id: ids.cash,
        method: CASH,
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

  // Each way to pay as a big tile, cash first; the one chosen is dark.
  const tab = (key: string, label: string, pick: () => void, active: boolean) => (
    <button
      key={key}
      type="button"
      aria-pressed={active}
      onClick={() => {
        pick();
        setTendered('');
      }}
      className={`flex min-h-14 min-w-24 flex-1 items-center justify-center gap-2 rounded-control border px-3 text-sm font-semibold transition-colors [&_svg]:size-5 ${
        active
          ? 'border-ink bg-ink text-white'
          : 'border-line bg-white text-ink hover:border-slate-400'
      }`}
    >
      {key === CASH ? (
        <Banknote aria-hidden="true" />
      ) : key === 'mixed' ? (
        <Split aria-hidden="true" />
      ) : (
        <CreditCard aria-hidden="true" />
      )}
      {label}
    </button>
  );

  const cashFields = cashPart !== null && cashPart > 0 && (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-slate-700">
        {mode === 'mixed'
          ? t('pos.pay.tenderedRest', { amount: fromMils(cashPart) })
          : t('pos.pay.tendered')}
        <input
          type="text"
          inputMode="decimal"
          dir="ltr"
          autoComplete="off"
          value={tendered}
          onChange={(event) => setTendered(normalizeNumberInput(event.target.value))}
          className={`${fieldClass} num text-2xl font-bold`}
        />
      </label>
      <div className="grid grid-cols-5 gap-2" dir="ltr">
        <button
          type="button"
          onClick={() => setTendered(fromMils(cashPart))}
          className={`${secondaryButtonClass} min-h-12`}
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
              className={`${secondaryButtonClass} num min-h-12 text-base`}
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
        required
        value={reference}
        onChange={(event) => setReference(event.target.value)}
        className={fieldClass}
      />
    </label>
  );

  const methodPicker = methods.length > 1 && (
    <label className="block text-sm font-medium text-slate-700">
      {t('pos.pay.mixedMethod')}
      <select
        value={methodKey}
        onChange={(event) => setMethodKey(event.target.value)}
        className={fieldClass}
      >
        {methods.map((candidate) => (
          <option key={candidate.key} value={candidate.key}>
            {localize(candidate.name, i18n.language)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Dialog title={t('pos.pay.title', { number: order.number })} onClose={onCancel}>
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="flex items-baseline justify-between rounded-control bg-slate-50 px-4 py-3">
          <span className="text-sm font-medium text-slate-600">{t('pos.pay.due')}</span>
          <span className="num text-3xl font-bold" data-testid="amount-due">
            <Price value={order.total} />
          </span>
        </p>

        {due > 0 && (
          <div className="flex flex-wrap gap-2">
            {tab(CASH, t('pos.pay.modes.cash'), () => setMode('cash'), mode === 'cash')}
            {methods.map((candidate) =>
              tab(
                candidate.key,
                localize(candidate.name, i18n.language),
                () => {
                  setMode('method');
                  setMethodKey(candidate.key);
                },
                mode === 'method' && methodKey === candidate.key,
              ),
            )}
            {methods.length > 0 &&
              tab('mixed', t('pos.pay.modes.mixed'), () => setMode('mixed'), mode === 'mixed')}
          </div>
        )}

        {due > 0 && mode === 'cash' && cashFields}
        {due > 0 && mode === 'method' && (
          <>
            <p className="text-sm text-slate-600">
              {t('pos.pay.otherHint', { method: methodName })}
            </p>
            {referenceField}
          </>
        )}
        {due > 0 && mode === 'mixed' && (
          <>
            {methodPicker}
            <label className="block text-sm font-medium text-slate-700">
              {t('pos.pay.methodAmount', { method: methodName })}
              <input
                type="text"
                inputMode="decimal"
                dir="ltr"
                autoComplete="off"
                value={methodAmount}
                onChange={(event) => setMethodAmount(normalizeNumberInput(event.target.value))}
                className={fieldClass}
              />
            </label>
            {referenceField}
            {cashFields}
          </>
        )}
        {due === 0 && <p className="text-sm text-slate-600">{t('pos.pay.nothingDue')}</p>}

        {cashPart !== null && cashPart > 0 && (
          <p className="flex items-center justify-between rounded-control bg-money-soft px-4 py-3 text-money">
            <span className="text-sm font-semibold">{t('pos.pay.change')}</span>
            <span className="num text-2xl font-bold" data-testid="change-due">
              <Price value={fromMils(change)} />
            </span>
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={!ready}
            className={`${moneyButtonClass} min-h-12 px-8 text-base`}
          >
            {due === 0 ? t('pos.pay.close') : t('pos.pay.confirm')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
