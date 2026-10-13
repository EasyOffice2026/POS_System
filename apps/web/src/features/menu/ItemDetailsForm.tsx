import {
  createItemRequestSchema,
  type MenuCategory,
  type MenuItem,
  priceSchema,
  type UpdateItemRequest,
  updateItemRequestSchema,
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
import { PriceInput } from '../../components/Price';
import { localize } from '../../i18n/localize';
import { fieldsFromIssues, messageFor, problemsFrom } from '../../lib/error-messages';
import { type CreateItemInput, createItem, menuKeys, updateItem } from './menu-api';

interface FormState {
  categoryId: string;
  en: string;
  ar: string;
  descriptionEn: string;
  descriptionAr: string;
  basePrice: string;
  imageUrl: string;
  isActive: boolean;
}

function initialState(existing: MenuItem | null, categoryId: string): FormState {
  if (existing) {
    return {
      categoryId: existing.categoryId,
      en: existing.name.en,
      ar: existing.name.ar,
      descriptionEn: existing.description?.en ?? '',
      descriptionAr: existing.description?.ar ?? '',
      basePrice: existing.basePrice,
      imageUrl: existing.imageUrl ?? '',
      isActive: existing.isActive,
    };
  }
  return {
    categoryId,
    en: '',
    ar: '',
    descriptionEn: '',
    descriptionAr: '',
    basePrice: '',
    imageUrl: '',
    isActive: true,
  };
}

// A description is in both languages or in neither. When only one is written, both are sent, so
// the rules say which one is missing.
function descriptionOf(form: FormState): { en: string; ar: string } | null {
  if (form.descriptionEn.trim() === '' && form.descriptionAr.trim() === '') return null;
  return { en: form.descriptionEn, ar: form.descriptionAr };
}

function newItemBody(form: FormState, brandId: string): CreateItemInput {
  const description = descriptionOf(form);
  const imageUrl = form.imageUrl.trim();
  return {
    brandId,
    categoryId: form.categoryId,
    name: { en: form.en, ar: form.ar },
    ...(description ? { description } : {}),
    basePrice: form.basePrice,
    ...(imageUrl ? { imageUrl } : {}),
    isActive: form.isActive,
  };
}

// Only what the person changed, so the audit log shows a true list of changes.
function changesFrom(form: FormState, existing: MenuItem): UpdateItemRequest {
  const changes: UpdateItemRequest = {};

  if (form.categoryId !== existing.categoryId) changes.categoryId = form.categoryId;
  if (form.en.trim() !== existing.name.en || form.ar.trim() !== existing.name.ar) {
    changes.name = { en: form.en, ar: form.ar };
  }

  const description = descriptionOf(form);
  const sameDescription =
    description === null || existing.description === null
      ? description === existing.description
      : description.en.trim() === existing.description.en &&
        description.ar.trim() === existing.description.ar;
  if (!sameDescription) changes.description = description;

  // "12.5" and "12.500" are the same price. A value the rules refuse is sent as it is, so the
  // problem is reported on the field.
  const price = priceSchema.safeParse(form.basePrice);
  if (!price.success || price.data !== existing.basePrice) changes.basePrice = form.basePrice;

  const imageUrl = form.imageUrl.trim();
  if (imageUrl !== (existing.imageUrl ?? '')) changes.imageUrl = imageUrl === '' ? null : imageUrl;
  return changes;
}

interface ItemDetailsFormProps {
  // The item being changed, or null to create one.
  existing: MenuItem | null;
  // The brand the item is created in. A group admin has to name it in the request.
  brandId: string;
  categories: MenuCategory[];
  // The category to start with when creating, from the address.
  initialCategoryId: string;
  readOnly: boolean;
}

// The category, names, description, price and image of an item. The server checks everything again.
export function ItemDetailsForm({
  existing,
  brandId,
  categories,
  initialCategoryId,
  readOnly,
}: ItemDetailsFormProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(() => initialState(existing, initialCategoryId));
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
        ? updateItem(existing.id, changesFrom(form, existing))
        : createItem(newItemBody(form, brandId)),
    onSuccess: async (item) => {
      queryClient.setQueryData(menuKeys.item(item.id), item);
      await queryClient.invalidateQueries({ queryKey: ['menu', item.brandId] });
      if (existing) setSaved(true);
      else void navigate(`/admin/menu/items/${item.id}`, { state: { notice: 'created' } });
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
      ? updateItemRequestSchema.safeParse(changesFrom(form, existing))
      : createItemRequestSchema.safeParse(newItemBody(form, brandId));
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    if (!form.categoryId) found.categoryId = 'CATEGORY_REQUIRED';
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
      <FormField
        id="item-category"
        label={t('menu.item.form.category')}
        error={error('categoryId')}
      >
        <select
          {...fieldAttributes('item-category', { error: Boolean(problems.categoryId) })}
          value={form.categoryId}
          disabled={readOnly}
          onChange={(event) => set('categoryId', event.target.value)}
          className={fieldClass}
        >
          <option value="">{t('menu.item.form.chooseCategory')}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {localize(category.name, i18n.language) +
                (category.isActive ? '' : ` ${t('common.inactiveSuffix')}`)}
            </option>
          ))}
        </select>
      </FormField>

      <BilingualNameFields
        idPrefix="item"
        value={{ en: form.en, ar: form.ar }}
        onChange={(name) => {
          setForm((current) => ({ ...current, ...name }));
          setSaved(false);
        }}
        errors={{ en: error('name.en'), ar: error('name.ar') }}
        disabled={readOnly}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="item-description-en"
          label={t('menu.item.form.descriptionEnglish')}
          hint={t('menu.item.form.descriptionHint')}
          error={error('description.en')}
        >
          <textarea
            {...fieldAttributes('item-description-en', {
              hint: true,
              error: Boolean(problems['description.en']),
            })}
            lang="en"
            dir="ltr"
            rows={3}
            value={form.descriptionEn}
            disabled={readOnly}
            onChange={(event) => set('descriptionEn', event.target.value)}
            className={fieldClass}
          />
        </FormField>

        <FormField
          id="item-description-ar"
          label={t('menu.item.form.descriptionArabic')}
          error={error('description.ar')}
        >
          <textarea
            {...fieldAttributes('item-description-ar', {
              error: Boolean(problems['description.ar']),
            })}
            lang="ar"
            dir="rtl"
            rows={3}
            value={form.descriptionAr}
            disabled={readOnly}
            onChange={(event) => set('descriptionAr', event.target.value)}
            className={fieldClass}
          />
        </FormField>
      </div>

      <FormField
        id="item-price"
        label={t('menu.item.form.basePrice')}
        hint={t('menu.item.form.basePriceHint')}
        error={error('basePrice')}
      >
        <PriceInput
          {...fieldAttributes('item-price', { hint: true, error: Boolean(problems.basePrice) })}
          value={form.basePrice}
          disabled={readOnly}
          onChange={(value) => set('basePrice', value)}
          className={`${fieldClass} max-w-xs`}
        />
      </FormField>

      <FormField
        id="item-image"
        label={t('menu.item.form.imageUrl')}
        hint={t('menu.item.form.imageUrlHint')}
        error={error('imageUrl')}
      >
        <input
          {...fieldAttributes('item-image', { hint: true, error: Boolean(problems.imageUrl) })}
          type="url"
          dir="ltr"
          autoComplete="off"
          value={form.imageUrl}
          disabled={readOnly}
          onChange={(event) => set('imageUrl', event.target.value)}
          className={fieldClass}
        />
      </FormField>

      {!existing && (
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => set('isActive', event.target.checked)}
            />
            {t('menu.item.form.active')}
          </label>
          <p className="mt-1 text-xs text-slate-500">{t('menu.item.form.activeHint')}</p>
        </div>
      )}

      {formProblem && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(formProblem, t)}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {t('menu.item.saved')}
        </p>
      )}

      {!readOnly && (
        <div className="flex gap-3">
          <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </button>
          {!existing && (
            <Link to={`/admin/menu/items?brandId=${brandId}`} className={secondaryButtonClass}>
              {t('common.cancel')}
            </Link>
          )}
        </div>
      )}
    </form>
  );
}
