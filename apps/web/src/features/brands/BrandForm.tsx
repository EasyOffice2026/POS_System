import {
  type Brand,
  createBrandRequestSchema,
  type UpdateBrandRequest,
  updateBrandRequestSchema,
} from '@pos/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { BilingualNameFields } from '../../components/BilingualNameFields';
import { ImageField } from '../../components/ImageField';
import { primaryButtonClass, secondaryButtonClass } from '../../components/form';
import { fieldsFromIssues, messageFor, problemsFrom } from '../../lib/error-messages';
import { type CreateBrandInput, createBrand, updateBrand } from './brands-api';

interface FormState {
  en: string;
  ar: string;
  logoUrl: string;
  isActive: boolean;
}

function initialState(existing: Brand | null): FormState {
  if (existing) {
    return {
      en: existing.name.en,
      ar: existing.name.ar,
      logoUrl: existing.logoUrl ?? '',
      isActive: existing.isActive,
    };
  }
  return { en: '', ar: '', logoUrl: '', isActive: true };
}

function newBrandBody(form: FormState): CreateBrandInput {
  const logoUrl = form.logoUrl.trim();
  return {
    name: { en: form.en, ar: form.ar },
    ...(logoUrl ? { logoUrl } : {}),
    isActive: form.isActive,
  };
}

// Only what the person changed, so the audit log shows a true list of changes.
function changesFrom(form: FormState, existing: Brand): UpdateBrandRequest {
  const changes: UpdateBrandRequest = {};
  const logoUrl = form.logoUrl.trim();

  if (form.en.trim() !== existing.name.en || form.ar.trim() !== existing.name.ar) {
    changes.name = { en: form.en, ar: form.ar };
  }
  if (logoUrl !== (existing.logoUrl ?? '')) changes.logoUrl = logoUrl === '' ? null : logoUrl;
  return changes;
}

// Creates a brand, or changes the one given. The server checks everything again.
export function BrandForm({ existing }: { existing: Brand | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(() => initialState(existing));
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
        ? updateBrand(existing.id, changesFrom(form, existing))
        : createBrand(newBrandBody(form)),
    onSuccess: async (brand) => {
      queryClient.setQueryData(['brand', brand.id], brand);
      await queryClient.invalidateQueries({ queryKey: ['brands'] });
      if (existing) setSaved(true);
      else void navigate('/admin/brands', { state: { notice: 'created' } });
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
      ? updateBrandRequestSchema.safeParse(changesFrom(form, existing))
      : createBrandRequestSchema.safeParse(newBrandBody(form));
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    save.mutate();
  }

  const error = (field: string) => (problems[field] ? messageFor(problems[field], t) : undefined);

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      <BilingualNameFields
        idPrefix="brand"
        value={{ en: form.en, ar: form.ar }}
        onChange={(name) => {
          setForm((current) => ({ ...current, ...name }));
          setSaved(false);
        }}
        errors={{ en: error('name.en'), ar: error('name.ar') }}
      />

      <ImageField
        id="brand-logo"
        label={t('brands.form.logoUrl')}
        hint={t(existing ? 'brands.form.logoUrlHint' : 'brands.form.logoUrlHintNew')}
        error={error('logoUrl')}
        value={form.logoUrl}
        kind="logo"
        brandId={existing?.id}
        canUpload={existing !== null}
        onChange={(url) => set('logoUrl', url)}
      />

      {!existing && (
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => set('isActive', event.target.checked)}
            />
            {t('brands.form.active')}
          </label>
          <p className="mt-1 text-xs text-slate-500">{t('brands.form.activeHint')}</p>
        </div>
      )}

      {formProblem && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(formProblem, t)}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {t('brands.saved')}
        </p>
      )}

      <div className="flex gap-3">
        <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
        <Link to="/admin/brands" className={secondaryButtonClass}>
          {t('common.cancel')}
        </Link>
      </div>
    </form>
  );
}
