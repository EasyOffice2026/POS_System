import {
  fromMils,
  type LoyaltySettings,
  maxPointsFor,
  type Order,
  pointsValueMils,
  toMils,
} from '@pos/shared';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import {
  fieldAttributes,
  fieldClass,
  FormField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { Price } from '../../components/Price';
import { messageFor } from '../../lib/error-messages';
import { normalizeNumberInput } from '../../lib/numbers';

interface PointsDialogProps {
  order: Order;
  loyalty: LoyaltySettings;
  // Spends the points; answers the problem to show, or null when it was done.
  onApply: (points: number) => Promise<string | null>;
  onCancel: () => void;
}

// The problem with spending this many points, the same rules the API checks (spec 022, rule 4).
export function pointsProblem(
  points: number,
  balance: number,
  most: number,
  loyalty: LoyaltySettings,
): string | null {
  if (!Number.isInteger(points) || points < 1) return 'POINTS_INVALID';
  if (points < loyalty.minRedeem) return 'POINTS_TOO_FEW';
  if (points > balance) return 'POINTS_NOT_ENOUGH';
  if (points > most) return 'POINTS_TOO_MANY';
  return null;
}

// How many of the customer's points to take off the bill, and what they are worth.
// See docs/specs/022-loyalty.md, rule 4.
export function PointsDialog({ order, loyalty, onApply, onCancel }: PointsDialogProps) {
  const { t } = useTranslation();
  const balance = order.customer?.points ?? 0;
  // What is left to pay before any points.
  const left = toMils(order.total) + toMils(order.pointsDiscount);
  const most = Math.min(balance, maxPointsFor(left, loyalty));
  const [text, setText] = useState(String(order.pointsRedeemed || most));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const typed = normalizeNumberInput(text).trim();
  const points = /^\d+$/.test(typed) ? Number(typed) : Number.NaN;
  const worth = Number.isNaN(points) ? 0 : Math.min(pointsValueMils(points, loyalty), left);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const found = pointsProblem(points, balance, most, loyalty);
    if (found) {
      setProblem(found);
      return;
    }
    setBusy(true);
    const answer = await onApply(points);
    setBusy(false);
    if (answer) setProblem(answer);
    else onCancel();
  }

  return (
    <Dialog title={t('pos.points.title')} onClose={onCancel}>
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
        <p className="text-sm">
          {t('pos.points.balance', { count: balance })}{' '}
          <span className="text-slate-600">
            ({t('pos.points.range', { min: loyalty.minRedeem, max: most })})
          </span>
        </p>
        <FormField
          id="points"
          label={t('pos.points.howMany')}
          error={problem ? messageFor(problem, t) : undefined}
        >
          <input
            {...fieldAttributes('points', { error: Boolean(problem) })}
            type="text"
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            value={text}
            onChange={(event) => {
              setProblem(null);
              setText(event.target.value);
            }}
            className={`${fieldClass} text-lg`}
          />
        </FormField>
        <p className="text-sm" data-testid="points-worth">
          {t('pos.points.worth')} <Price value={fromMils(worth)} />
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={busy} className={primaryButtonClass}>
            {t('pos.points.apply')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
