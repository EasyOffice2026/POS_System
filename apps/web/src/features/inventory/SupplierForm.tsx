import { createSupplierRequestSchema, type SupplierDetail } from '@pos/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fieldAttributes,
  fieldClass,
  FormField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { fieldsFromIssues, messageFor, problemsFrom } from '../../lib/error-messages';
import { normalizeNumberInput } from '../../lib/numbers';
import { createSupplier, inventoryKeys, updateSupplier } from './inventory-api';

interface FormState {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  paymentDays: string;
  notes: string;
}

const empty: FormState = {
  name: '',
  contactName: '',
  phone: '',
  email: '',
  address: '',
  paymentDays: '0',
  notes: '',
};

const fromSupplier = (supplier: SupplierDetail): FormState => ({
  name: supplier.name,
  contactName: supplier.contactName ?? '',
  phone: supplier.phone ?? '',
  email: supplier.email ?? '',
  address: supplier.address ?? '',
  paymentDays: String(supplier.paymentDays),
  notes: supplier.notes ?? '',
});

interface SupplierFormProps {
  brandId: string;
  // The supplier being changed, or null for a new one.
  existing: SupplierDetail | null;
  onDone: (saved: SupplierDetail | null) => void;
}

// A supplier's name and how to reach them (spec 017, rules 1 and 2).
export function SupplierForm({ brandId, existing, onDone }: SupplierFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => (existing ? fromSupplier(existing) : empty));
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const prefix = existing ? `supplier-${existing.id}` : 'supplier-new';

  const body = () => ({
    name: form.name,
    contactName: form.contactName,
    phone: form.phone,
    email: form.email,
    address: form.address,
    paymentDays: form.paymentDays.trim() === '' ? 0 : Number(form.paymentDays),
    notes: form.notes,
  });

  const save = useMutation({
    mutationFn: () => {
      const parsed = createSupplierRequestSchema.parse(body());
      const fields = {
        name: parsed.name,
        contactName: parsed.contactName ?? '',
        phone: parsed.phone ?? '',
        email: parsed.email ?? '',
        address: parsed.address ?? '',
        paymentDays: parsed.paymentDays,
        notes: parsed.notes ?? '',
      };
      return existing
        ? updateSupplier(existing.id, fields)
        : createSupplier({ ...fields, brandId });
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      onDone(saved);
    },
    onError: (error) => {
      const found = problemsFrom(error, { notFound: 'SUPPLIER_NOT_FOUND' });
      setProblems(found.fields);
      setFormProblem(found.form);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormProblem(null);
    const result = createSupplierRequestSchema.safeParse(body());
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    save.mutate();
  }
  const error = (field: string) => (problems[field] ? messageFor(problems[field], t) : undefined);
  const text = (field: keyof FormState, label: string, extra: object = {}) => (
    <FormField id={`${prefix}-${field}`} label={label} error={error(field)}>
      <input
        {...fieldAttributes(`${prefix}-${field}`, { error: Boolean(error(field)) })}
        type="text"
        value={form[field]}
        onChange={(event) => setForm({ ...form, [field]: event.target.value })}
        className={fieldClass}
        {...extra}
      />
    </FormField>
  );

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 className="font-semibold">
        {existing ? t('inventory.suppliers.edit') : t('inventory.suppliers.add')}
      </h2>
      {text('name', t('inventory.suppliers.name'), { dir: 'auto' })}
      <div className="grid gap-3 sm:grid-cols-2">
        {text('contactName', t('inventory.suppliers.contactName'), { dir: 'auto' })}
        {text('phone', t('inventory.suppliers.phone'), { dir: 'ltr', inputMode: 'tel' })}
        {text('email', t('inventory.suppliers.email'), { dir: 'ltr', inputMode: 'email' })}
        <FormField
          id={`${prefix}-paymentDays`}
          label={t('inventory.suppliers.paymentDays')}
          hint={t('inventory.suppliers.paymentDaysHint')}
          error={error('paymentDays')}
        >
          <input
            {...fieldAttributes(`${prefix}-paymentDays`, {
              hint: true,
              error: Boolean(error('paymentDays')),
            })}
            type="text"
            inputMode="numeric"
            dir="ltr"
            value={form.paymentDays}
            onChange={(event) =>
              setForm({ ...form, paymentDays: normalizeNumberInput(event.target.value) })
            }
            className={fieldClass}
          />
        </FormField>
      </div>
      {text('address', t('inventory.suppliers.address'), { dir: 'auto' })}
      {text('notes', t('inventory.suppliers.notes'), { dir: 'auto' })}
      {formProblem && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(formProblem, t)}
        </p>
      )}
      <div className="flex gap-3">
        <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
        <button type="button" onClick={() => onDone(null)} className={secondaryButtonClass}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
