import { customerPhoneSchema } from '@pos/shared';
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
import { messageFor, problemsFrom } from '../../lib/error-messages';
import { findCustomer } from './pos-api';

interface CustomerDialogProps {
  // Puts the customer on the order; answers the problem to show, or null when it was done.
  onApply: (input: { phone: string; name?: string }) => Promise<string | null>;
  onCancel: () => void;
}

// The box for the customer's phone. A customer found goes on the order at once; a new phone
// asks for a name, which may stay empty, and adds them. See docs/specs/022-loyalty.md, rule 2.
export function CustomerDialog({ onApply, onCancel }: CustomerDialogProps) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  // The phone as it is kept, once it is known to be new.
  const [newPhone, setNewPhone] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function apply(input: { phone: string; name?: string }) {
    const answer = await onApply(input);
    if (answer) setProblem(answer);
    else onCancel();
  }

  async function onFind(event: FormEvent) {
    event.preventDefault();
    const parsed = customerPhoneSchema.safeParse(phone);
    if (!parsed.success) {
      setProblem('PHONE_INVALID');
      return;
    }
    setBusy(true);
    try {
      const found = await findCustomer(parsed.data);
      if (found) await apply({ phone: found.phone });
      else setNewPhone(parsed.data);
    } catch (error) {
      setProblem(problemsFrom(error).form ?? 'saveError');
    } finally {
      setBusy(false);
    }
  }

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    if (!newPhone) return;
    setBusy(true);
    const trimmed = name.trim();
    await apply(trimmed ? { phone: newPhone, name: trimmed } : { phone: newPhone });
    setBusy(false);
  }

  const problemText = problem ? messageFor(problem, t) : undefined;

  return (
    <Dialog title={t('pos.customer.title')} onClose={onCancel}>
      {newPhone === null ? (
        <form onSubmit={(event) => void onFind(event)} noValidate className="space-y-4">
          <FormField
            id="customer-phone"
            label={t('pos.customer.phone')}
            hint={t('pos.customer.phoneHint')}
            error={problemText}
          >
            <input
              {...fieldAttributes('customer-phone', { hint: true, error: Boolean(problem) })}
              type="tel"
              dir="ltr"
              autoComplete="off"
              inputMode="tel"
              value={phone}
              onChange={(event) => {
                setProblem(null);
                setPhone(event.target.value);
              }}
              className={`${fieldClass} text-lg`}
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel} className={secondaryButtonClass}>
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={busy} className={primaryButtonClass}>
              {t('pos.customer.find')}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={(event) => void onAdd(event)} noValidate className="space-y-4">
          <p className="text-sm">
            {t('pos.customer.isNew')} <bdi dir="ltr">{newPhone}</bdi>
          </p>
          <FormField
            id="customer-name"
            label={t('pos.customer.name')}
            hint={t('pos.customer.nameHint')}
            error={problemText}
          >
            <input
              {...fieldAttributes('customer-name', { hint: true, error: Boolean(problem) })}
              type="text"
              dir="auto"
              autoComplete="off"
              maxLength={100}
              value={name}
              onChange={(event) => {
                setProblem(null);
                setName(event.target.value);
              }}
              className={fieldClass}
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setProblem(null);
                setNewPhone(null);
              }}
              className={secondaryButtonClass}
            >
              {t('pos.customer.back')}
            </button>
            <button type="submit" disabled={busy} className={primaryButtonClass}>
              {t('pos.customer.add')}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
