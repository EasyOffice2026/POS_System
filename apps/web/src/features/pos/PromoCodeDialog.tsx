import { putPromoCodeRequestSchema } from '@pos/shared';
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
import { messageFor } from '../../lib/error-messages';

interface PromoCodeDialogProps {
  // Types the code; answers the problem to show, or null when it was taken.
  onApply: (code: string) => Promise<string | null>;
  onCancel: () => void;
}

// The box for a promotion code a customer gives (docs/specs/021-promotions.md, rule 5).
export function PromoCodeDialog({ onApply, onCancel }: PromoCodeDialogProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = putPromoCodeRequestSchema.safeParse({ code });
    if (!parsed.success) {
      setProblem('PROMO_CODE_INVALID');
      return;
    }
    setBusy(true);
    const answer = await onApply(parsed.data.code);
    setBusy(false);
    if (answer) setProblem(answer);
    else onCancel();
  }

  return (
    <Dialog title={t('pos.promo.title')} onClose={onCancel}>
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
        <FormField
          id="promo-code"
          label={t('pos.promo.code')}
          error={problem ? messageFor(problem, t) : undefined}
        >
          <input
            {...fieldAttributes('promo-code', { error: Boolean(problem) })}
            type="text"
            dir="ltr"
            autoComplete="off"
            autoCapitalize="characters"
            value={code}
            onChange={(event) => {
              setProblem(null);
              setCode(event.target.value);
            }}
            className={`${fieldClass} text-lg uppercase`}
          />
        </FormField>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={busy} className={primaryButtonClass}>
            {t('pos.promo.apply')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
