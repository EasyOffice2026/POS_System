import {
  adjustPointsRequestSchema,
  type CustomerDetail,
  updateCustomerRequestSchema,
} from '@pos/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router';
import {
  fieldAttributes,
  fieldClass,
  FormField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { Price } from '../../components/Price';
import { formatDateTime } from '../../i18n/format';
import { fieldsFromIssues, messageFor, problemsFrom } from '../../lib/error-messages';
import { normalizeNumberInput } from '../../lib/numbers';
import { useAuth } from '../auth/auth-context';
import { adjustPoints, customerKeys, getCustomer, updateCustomer } from './customers-api';

// One customer: their details, their points and every change of them.
// See docs/specs/022-loyalty.md.
export function CustomerPage() {
  const { t } = useTranslation();
  // A group admin's brand is in the address; the way back keeps it.
  const { search } = useLocation();
  const { id = '' } = useParams();
  const customer = useQuery({ queryKey: customerKeys.one(id), queryFn: () => getCustomer(id) });

  return (
    <div className="space-y-4">
      <Link
        to={{ pathname: '..', search }}
        relative="path"
        className="text-sm text-slate-600 underline"
      >
        {t('customers.back')}
      </Link>
      {customer.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {customer.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {customer.data && <CustomerSheet key={customer.data.id} customer={customer.data} />}
    </div>
  );
}

function CustomerSheet({ customer }: { customer: CustomerDetail }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const canWrite = user?.permissions.includes('customers:write') ?? false;
  const [editing, setEditing] = useState(false);

  const detail = (label: string, value: ReactNode) => (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {customer.name ? <bdi>{customer.name}</bdi> : <bdi dir="ltr">{customer.phone}</bdi>}
          </h1>
          <p className="text-sm text-slate-600">
            <bdi dir="ltr">{customer.phone}</bdi>
            {customer.email && (
              <>
                {' · '}
                <bdi dir="ltr">{customer.email}</bdi>
              </>
            )}
          </p>
          {customer.notes && <p className="mt-1 text-sm whitespace-pre-line">{customer.notes}</p>}
        </div>
        {canWrite && !editing && (
          <button type="button" onClick={() => setEditing(true)} className={secondaryButtonClass}>
            {t('customers.edit')}
          </button>
        )}
      </div>

      {editing && <CustomerForm customer={customer} onDone={() => setEditing(false)} />}

      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4">
        {detail(
          t('customers.points'),
          <span data-testid="customer-points">{customer.points}</span>,
        )}
        {detail(t('customers.visits'), customer.visits)}
        {detail(t('customers.spent'), <Price value={customer.totalSpent} />)}
        {detail(
          t('customers.lastVisit'),
          customer.lastVisitAt ? formatDateTime(customer.lastVisitAt, i18n.language) : '—',
        )}
      </dl>

      {canWrite && <PointsForm customer={customer} />}

      <section className="space-y-2" aria-labelledby="customer-history">
        <h2 id="customer-history" className="text-lg font-semibold">
          {t('customers.history')}
        </h2>
        {customer.entries.length === 0 ? (
          <p className="text-sm text-slate-500">{t('customers.noHistory')}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{t('customers.when')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('customers.what')}</th>
                  <th className="px-3 py-2 text-end font-medium">{t('customers.points')}</th>
                  <th className="px-3 py-2 text-end font-medium">{t('customers.balance')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('customers.by')}</th>
                </tr>
              </thead>
              <tbody>
                {customer.entries.map((entry) => (
                  <tr key={entry.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatDateTime(entry.createdAt, i18n.language)}
                    </td>
                    <td className="px-3 py-2">
                      {t(`customers.kinds.${entry.kind}`)}
                      {entry.orderNumber !== null && (
                        <> · {t('pos.order.number', { number: entry.orderNumber })}</>
                      )}
                      {entry.note && (
                        <p className="text-xs text-slate-600">
                          <bdi>{entry.note}</bdi>
                        </p>
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-end font-medium ${
                        entry.points < 0 ? 'text-red-700' : 'text-emerald-800'
                      }`}
                    >
                      <bdi dir="ltr">{entry.points > 0 ? `+${entry.points}` : entry.points}</bdi>
                    </td>
                    <td className="px-3 py-2 text-end">{entry.balanceAfter}</td>
                    <td className="px-3 py-2">{entry.byName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// The name, email and notes of a customer. The phone identifies them and is not changed.
function CustomerForm({ customer, onDone }: { customer: CustomerDetail; onDone: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState(customer.name ?? '');
  const [email, setEmail] = useState(customer.email ?? '');
  const [notes, setNotes] = useState(customer.notes ?? '');
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: { name: string; email: string; notes: string }) =>
      updateCustomer(customer.id, body),
    onSuccess: async (saved) => {
      queryClient.setQueryData(customerKeys.one(customer.id), saved);
      await queryClient.invalidateQueries({ queryKey: customerKeys.all });
      onDone();
    },
    onError: (error) => {
      const found = problemsFrom(error);
      setProblems(found.fields);
      setFormProblem(found.form);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormProblem(null);
    const body = { name, email, notes };
    const result = updateCustomerRequestSchema.safeParse(body);
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    setProblems(found);
    if (Object.keys(found).length === 0) save.mutate(body);
  }

  const error = (field: string) => (problems[field] ? messageFor(problems[field], t) : undefined);

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="customer-name" label={t('customers.name')} error={error('name')}>
          <input
            {...fieldAttributes('customer-name', { error: Boolean(error('name')) })}
            type="text"
            dir="auto"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={fieldClass}
          />
        </FormField>
        <FormField id="customer-email" label={t('customers.email')} error={error('email')}>
          <input
            {...fieldAttributes('customer-email', { error: Boolean(error('email')) })}
            type="email"
            dir="ltr"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={fieldClass}
          />
        </FormField>
      </div>
      <FormField id="customer-notes" label={t('customers.notes')} error={error('notes')}>
        <textarea
          {...fieldAttributes('customer-notes', { error: Boolean(error('notes')) })}
          dir="auto"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className={fieldClass}
        />
      </FormField>
      {formProblem && (
        <p role="alert" className="text-sm text-red-700">
          {messageFor(formProblem, t)}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
        <button type="button" onClick={onDone} className={secondaryButtonClass}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

// Points given or taken by hand, with the reason (spec 022, rule 5).
function PointsForm({ customer }: { customer: CustomerDetail }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [take, setTake] = useState(false);
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const save = useMutation({
    mutationFn: (body: { points: number; reason: string }) => adjustPoints(customer.id, body),
    onSuccess: async (saved) => {
      queryClient.setQueryData(customerKeys.one(customer.id), saved);
      await queryClient.invalidateQueries({ queryKey: customerKeys.all });
      setPoints('');
      setReason('');
      setDone(true);
    },
    onError: (error) => {
      const found = problemsFrom(error);
      setProblems(found.fields);
      setFormProblem(found.form);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormProblem(null);
    setDone(false);
    const typed = normalizeNumberInput(points).trim();
    const count = /^\d+$/.test(typed) ? Number(typed) : Number.NaN;
    const body = { points: take ? -count : count, reason };
    const result = adjustPointsRequestSchema.safeParse(body);
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    if (result.success && take && count > customer.points) found.points = 'POINTS_NOT_ENOUGH';
    setProblems(found);
    if (Object.keys(found).length === 0 && result.success) save.mutate(result.data);
  }

  const error = (field: string) => (problems[field] ? messageFor(problems[field], t) : undefined);

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby="customer-adjust"
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 id="customer-adjust" className="text-lg font-semibold">
        {t('customers.adjust.title')}
      </h2>
      <fieldset className="flex gap-4 text-sm">
        <legend className="sr-only">{t('customers.adjust.title')}</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="adjust" checked={!take} onChange={() => setTake(false)} />
          {t('customers.adjust.give')}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="adjust" checked={take} onChange={() => setTake(true)} />
          {t('customers.adjust.take')}
        </label>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <FormField id="adjust-points" label={t('customers.adjust.points')} error={error('points')}>
          <input
            {...fieldAttributes('adjust-points', { error: Boolean(error('points')) })}
            type="text"
            inputMode="numeric"
            dir="ltr"
            value={points}
            onChange={(event) => {
              setDone(false);
              setPoints(event.target.value);
            }}
            className={fieldClass}
          />
        </FormField>
        <FormField id="adjust-reason" label={t('customers.adjust.reason')} error={error('reason')}>
          <input
            {...fieldAttributes('adjust-reason', { error: Boolean(error('reason')) })}
            type="text"
            dir="auto"
            maxLength={200}
            value={reason}
            onChange={(event) => {
              setDone(false);
              setReason(event.target.value);
            }}
            className={fieldClass}
          />
        </FormField>
      </div>
      {formProblem && (
        <p role="alert" className="text-sm text-red-700">
          {messageFor(formProblem, t)}
        </p>
      )}
      {done && (
        <p role="status" className="text-sm text-emerald-800">
          {t('customers.adjust.done')}
        </p>
      )}
      <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
        {take ? t('customers.adjust.takeButton') : t('customers.adjust.giveButton')}
      </button>
    </form>
  );
}
