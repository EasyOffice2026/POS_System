import {
  type DiscountKind,
  fromMils,
  type Order,
  percentOfMils,
  setDiscountRequestSchema,
  toMils,
} from '@pos/shared';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { fieldClass, primaryButtonClass, secondaryButtonClass } from '../../components/form';
import { Price } from '../../components/Price';
import { normalizeNumberInput } from '../../lib/numbers';
import type { DiscountInput } from './pos-api';

// What the discount comes to on the order as it is now, worked out like the API does (spec 005,
// rule 10), or null while the value is not valid.
function amountOf(kind: DiscountKind, value: string, subtotal: string): string | null {
  const parsed = setDiscountRequestSchema.safeParse({ kind, value, reason: 'x' });
  if (!parsed.success) return null;
  const base = toMils(subtotal);
  const amount =
    kind === 'percent'
      ? percentOfMils(base, parsed.data.value)
      : Math.min(toMils(parsed.data.value), base);
  return fromMils(amount);
}

interface DiscountDialogProps {
  order: Order;
  // The percentage buttons of the brand, from its settings (spec 009, rule 3).
  presets: string[];
  onApply: (input: DiscountInput) => void;
  onRemove: () => void;
  onCancel: () => void;
}

// One discount on the whole order: a percentage or an amount, and why. See
// docs/specs/006-pos-terminal.md, rule 11.
export function DiscountDialog({
  order,
  presets,
  onApply,
  onRemove,
  onCancel,
}: DiscountDialogProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<DiscountKind>(order.discount?.kind ?? 'percent');
  const [value, setValue] = useState(order.discount?.value ?? '');
  const [reason, setReason] = useState(order.discount?.reason ?? '');

  // The discount is worked out on what is left after the promotions (spec 021, rule 6).
  const amount = amountOf(
    kind,
    value,
    fromMils(toMils(order.subtotal) - toMils(order.promotionDiscount)),
  );
  const ready = amount !== null && reason.trim() !== '';

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (ready) onApply({ kind, value: value.trim(), reason: reason.trim() });
  }

  const tab = (key: DiscountKind) => (
    <button
      type="button"
      aria-pressed={kind === key}
      onClick={() => {
        setKind(key);
        setValue('');
      }}
      className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${
        kind === key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }`}
    >
      {t(`pos.discount.${key}`)}
    </button>
  );

  return (
    <Dialog title={t('pos.discount.title')} onClose={onCancel}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="flex gap-2">
          {tab('percent')}
          {tab('amount')}
        </div>

        <label className="block text-sm font-medium text-slate-700">
          {kind === 'percent' ? t('pos.discount.percentValue') : t('pos.discount.amountValue')}
          <input
            type="text"
            inputMode="decimal"
            dir="ltr"
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(normalizeNumberInput(event.target.value))}
            className={fieldClass}
          />
        </label>

        {kind === 'percent' && (
          <div className="grid grid-cols-6 gap-2" dir="ltr">
            {presets.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setValue(Number(preset).toString())}
                className="rounded-md border border-slate-200 py-2 text-sm font-medium hover:bg-slate-100"
              >
                {Number(preset)}%
              </button>
            ))}
          </div>
        )}

        <label className="block text-sm font-medium text-slate-700">
          {t('pos.discount.reason')}
          <input
            type="text"
            dir="auto"
            maxLength={200}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={fieldClass}
          />
        </label>

        <p className="flex items-center justify-between rounded-md bg-slate-50 p-3 text-sm">
          <span className="text-slate-600">{t('pos.discount.preview')}</span>
          <span className="text-lg font-semibold" data-testid="discount-preview">
            {amount === null ? '–' : <Price value={amount} />}
          </span>
        </p>
        {value !== '' && amount === null && (
          <p role="alert" className="text-sm text-red-700">
            {t('pos.errors.DISCOUNT_VALUE_INVALID')}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {order.discount && (
            <button type="button" onClick={onRemove} className={secondaryButtonClass}>
              {t('pos.discount.remove')}
            </button>
          )}
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={!ready} className={primaryButtonClass}>
            {t('pos.discount.apply')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
