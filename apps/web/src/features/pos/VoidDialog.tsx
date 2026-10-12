import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { fieldClass, primaryButtonClass, secondaryButtonClass } from '../../components/form';

// The usual reasons, in the language of the screen. The reason is stored as it was shown.
const reasons = ['changedMind', 'wrongItem', 'tooLong', 'quality', 'other'] as const;
type Reason = (typeof reasons)[number];

interface VoidDialogProps {
  // What is voided: a line ("Cola × 2") or the order ("Order 12").
  what: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

// Asks why a line or an order is voided. See docs/specs/006-pos-terminal.md, rule 10.
export function VoidDialog({ what, onConfirm, onCancel }: VoidDialogProps) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<Reason | null>(null);
  const [other, setOther] = useState('');

  const reason = choice === 'other' ? other.trim() : choice ? t(`pos.void.reasons.${choice}`) : '';

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (reason) onConfirm(reason.slice(0, 200));
  }

  return (
    <Dialog title={t('pos.void.title', { what })} onClose={onCancel}>
      <form onSubmit={onSubmit} className="space-y-3">
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-slate-700">
            {t('pos.void.reason')}
          </legend>
          {reasons.map((key) => (
            <label
              key={key}
              className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
            >
              <input
                type="radio"
                name="reason"
                checked={choice === key}
                onChange={() => setChoice(key)}
              />
              {t(`pos.void.reasons.${key}`)}
            </label>
          ))}
        </fieldset>
        {choice === 'other' && (
          <label className="block text-sm font-medium text-slate-700">
            {t('pos.void.otherReason')}
            <input
              type="text"
              dir="auto"
              maxLength={200}
              value={other}
              onChange={(event) => setOther(event.target.value)}
              className={fieldClass}
            />
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={!reason} className={primaryButtonClass}>
            {t('pos.void.confirm')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
