import {
  type AuthUser,
  type BranchDetail,
  type Brand,
  createBranchRequestSchema,
  DEFAULT_TIMEZONE,
  updateBranchRequestSchema,
} from '@pos/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { BilingualNameFields } from '../../components/BilingualNameFields';
import {
  FormField,
  fieldAttributes,
  fieldClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { localize } from '../../i18n/localize';
import { fieldsFromIssues, messageFor, problemsFrom } from '../../lib/error-messages';
import { timeZoneGroups } from '../../lib/time-zones';
import {
  type CreateBranchInput,
  createBranch,
  type UpdateBranchInput,
  updateBranch,
} from './branches-api';

interface FormState {
  en: string;
  ar: string;
  address: string;
  timezone: string;
  brandId: string;
  isActive: boolean;
}

function initialState(existing: BranchDetail | null, brandId: string): FormState {
  if (existing) {
    return {
      en: existing.name.en,
      ar: existing.name.ar,
      address: existing.address ?? '',
      timezone: existing.timezone,
      brandId: existing.brandId,
      isActive: existing.isActive,
    };
  }
  return { en: '', ar: '', address: '', timezone: DEFAULT_TIMEZONE, brandId, isActive: true };
}

function newBranchBody(form: FormState): CreateBranchInput {
  const address = form.address.trim();
  return {
    name: { en: form.en, ar: form.ar },
    ...(address ? { address } : {}),
    timezone: form.timezone,
    isActive: form.isActive,
  };
}

// Only what the person changed, so the audit log shows a true list of changes.
function changesFrom(form: FormState, existing: BranchDetail): UpdateBranchInput {
  const changes: UpdateBranchInput = {};
  const address = form.address.trim();

  if (form.en.trim() !== existing.name.en || form.ar.trim() !== existing.name.ar) {
    changes.name = { en: form.en, ar: form.ar };
  }
  if (address !== (existing.address ?? '')) changes.address = address === '' ? null : address;
  if (form.timezone !== existing.timezone) changes.timezone = form.timezone;
  return changes;
}

interface BranchDetailsFormProps {
  // The branch being changed, or null to create one.
  existing: BranchDetail | null;
  me: AuthUser;
  brands: Brand[];
  // The brand to start with when creating, from the address.
  initialBrandId: string;
  readOnly: boolean;
}

// The names, address and time zone of a branch. A group admin who creates a branch also chooses
// the brand; for everybody else the brand is their own.
export function BranchDetailsForm({
  existing,
  me,
  brands,
  initialBrandId,
  readOnly,
}: BranchDetailsFormProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const chooseBrand = !existing && me.scope === 'GROUP';
  const [form, setForm] = useState<FormState>(() =>
    initialState(existing, me.scope === 'GROUP' ? initialBrandId : (me.brandId ?? '')),
  );
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const save = useMutation({
    mutationFn: () =>
      existing
        ? updateBranch(existing.id, changesFrom(form, existing))
        : createBranch(form.brandId, newBranchBody(form)),
    onSuccess: async (branch) => {
      queryClient.setQueryData(['branch', branch.id], branch);
      await queryClient.invalidateQueries({ queryKey: ['branches'] });
      if (existing) setSaved(true);
      else void navigate(`/admin/branches/${branch.id}`, { state: { notice: 'created' } });
    },
    onError: (error) => {
      const found = problemsFrom(error, { notFound: 'ITEM_NOT_FOUND' });
      setProblems(found.fields);
      setFormProblem(found.form);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    setFormProblem(null);

    if (existing && Object.keys(changesFrom(form, existing)).length === 0) {
      setProblems({});
      setSaved(true);
      return;
    }

    const result = existing
      ? updateBranchRequestSchema.safeParse(changesFrom(form, existing))
      : createBranchRequestSchema.safeParse(newBranchBody(form));
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    if (!existing && !form.brandId) found.brandId = 'BRAND_REQUIRED';
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    save.mutate();
  }

  const error = (field: string) => (problems[field] ? messageFor(problems[field], t) : undefined);
  const inactive = (isActive: boolean) => (isActive ? '' : ` ${t('common.inactiveSuffix')}`);

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      {chooseBrand && (
        <FormField id="branch-brand" label={t('branches.form.brand')} error={error('brandId')}>
          <select
            {...fieldAttributes('branch-brand', { error: Boolean(problems.brandId) })}
            value={form.brandId}
            onChange={(event) => set('brandId', event.target.value)}
            className={fieldClass}
          >
            <option value="">{t('branches.form.chooseBrand')}</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {localize(brand.name, i18n.language) + inactive(brand.isActive)}
              </option>
            ))}
          </select>
        </FormField>
      )}

      <BilingualNameFields
        idPrefix="branch"
        value={{ en: form.en, ar: form.ar }}
        onChange={(name) => {
          setForm((current) => ({ ...current, ...name }));
          setSaved(false);
        }}
        errors={{ en: error('name.en'), ar: error('name.ar') }}
        disabled={readOnly}
      />

      <FormField id="branch-address" label={t('branches.form.address')} error={error('address')}>
        <input
          {...fieldAttributes('branch-address', { error: Boolean(problems.address) })}
          type="text"
          dir="auto"
          autoComplete="off"
          value={form.address}
          disabled={readOnly}
          onChange={(event) => set('address', event.target.value)}
          className={fieldClass}
        />
      </FormField>

      <FormField id="branch-timezone" label={t('branches.form.timezone')} error={error('timezone')}>
        <select
          {...fieldAttributes('branch-timezone', { error: Boolean(problems.timezone) })}
          dir="ltr"
          value={form.timezone}
          disabled={readOnly}
          onChange={(event) => set('timezone', event.target.value)}
          className={fieldClass}
        >
          {timeZoneGroups(form.timezone).map((group) => (
            <optgroup key={group.region} label={group.region}>
              {group.names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </FormField>

      {!existing && (
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => set('isActive', event.target.checked)}
            />
            {t('branches.form.active')}
          </label>
          <p className="mt-1 text-xs text-slate-500">{t('branches.form.activeHint')}</p>
        </div>
      )}

      {formProblem && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(formProblem, t)}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {t('branches.saved')}
        </p>
      )}

      {!readOnly && (
        <div className="flex gap-3">
          <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </button>
          {!existing && (
            <Link
              to={form.brandId ? `/admin/branches?brandId=${form.brandId}` : '/admin/branches'}
              className={secondaryButtonClass}
            >
              {t('common.cancel')}
            </Link>
          )}
        </div>
      )}
    </form>
  );
}
