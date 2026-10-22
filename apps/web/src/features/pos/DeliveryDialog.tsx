import { type DeliveryDetails, deliveryDetailsSchema } from '@pos/shared';
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
import { fieldsFromIssues, messageFor } from '../../lib/error-messages';

interface DeliveryDialogProps {
  // The details already on the order, to change them.
  current: DeliveryDetails | null;
  // Puts the details on the order; answers the problem to show, or null when it was done.
  onApply: (details: DeliveryDetails) => Promise<string | null>;
  onCancel: () => void;
}

// The box for a delivery order: the customer's phone and address, and what the driver should
// know. Both the phone and the address are needed before the order is sent or paid
// (docs/specs/026-order-types.md, rule 5).
export function DeliveryDialog({ current, onApply, onCancel }: DeliveryDialogProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    phone: current?.phone ?? '',
    name: current?.name ?? '',
    address: current?.address ?? '',
    note: current?.note ?? '',
  });
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const change = (field: keyof typeof form, value: string) => {
    setProblems({});
    setForm((all) => ({ ...all, [field]: value }));
  };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = deliveryDetailsSchema.safeParse(form);
    if (!parsed.success) {
      setProblems(fieldsFromIssues(parsed.error.issues));
      return;
    }
    setBusy(true);
    const answer = await onApply(parsed.data);
    setBusy(false);
    if (answer) setProblems({ form: answer });
    else onCancel();
  }

  const problem = (field: string) => (problems[field] ? messageFor(problems[field], t) : undefined);

  return (
    <Dialog title={t('pos.delivery.title')} onClose={onCancel}>
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
        <FormField id="delivery-phone" label={t('pos.delivery.phone')} error={problem('phone')}>
          <input
            {...fieldAttributes('delivery-phone', { error: Boolean(problems.phone) })}
            type="tel"
            dir="ltr"
            inputMode="tel"
            autoComplete="off"
            value={form.phone}
            onChange={(event) => change('phone', event.target.value)}
            className={`${fieldClass} text-lg`}
          />
        </FormField>
        <FormField
          id="delivery-name"
          label={t('pos.delivery.name')}
          hint={t('pos.delivery.optional')}
          error={problem('name')}
        >
          <input
            {...fieldAttributes('delivery-name', { hint: true, error: Boolean(problems.name) })}
            type="text"
            dir="auto"
            autoComplete="off"
            maxLength={80}
            value={form.name}
            onChange={(event) => change('name', event.target.value)}
            className={fieldClass}
          />
        </FormField>
        <FormField
          id="delivery-address"
          label={t('pos.delivery.address')}
          error={problem('address')}
        >
          <textarea
            {...fieldAttributes('delivery-address', { error: Boolean(problems.address) })}
            dir="auto"
            rows={3}
            maxLength={300}
            value={form.address}
            onChange={(event) => change('address', event.target.value)}
            className={fieldClass}
          />
        </FormField>
        <FormField
          id="delivery-note"
          label={t('pos.delivery.note')}
          hint={t('pos.delivery.optional')}
          error={problem('note')}
        >
          <input
            {...fieldAttributes('delivery-note', { hint: true, error: Boolean(problems.note) })}
            type="text"
            dir="auto"
            autoComplete="off"
            maxLength={200}
            value={form.note}
            onChange={(event) => change('note', event.target.value)}
            className={fieldClass}
          />
        </FormField>
        {problems.form && (
          <p role="alert" className="text-sm text-red-700">
            {messageFor(problems.form, t)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={busy} className={primaryButtonClass}>
            {t('pos.delivery.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
