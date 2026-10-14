import {
  type Promotion,
  type PromotionKind,
  type PromotionScope,
  updatePromotionRequestSchema,
} from '@pos/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { ActiveBadge } from '../../components/ActiveBadge';
import { BilingualNameFields } from '../../components/BilingualNameFields';
import {
  fieldAttributes,
  fieldClass,
  FormField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { PriceInput } from '../../components/Price';
import { formatDate } from '../../i18n/format';
import { localize } from '../../i18n/localize';
import { fieldsFromIssues, messageFor, problemsFrom } from '../../lib/error-messages';
import { normalizeNumberInput } from '../../lib/numbers';
import { useAuth } from '../auth/auth-context';
import {
  createPromotion,
  listAllItems,
  listCategories,
  listPromotions,
  menuKeys,
  type PromotionInput,
  promotionKeys,
  updatePromotion,
} from './menu-api';
import { useMenuContext } from './menu-context';

const kinds: PromotionKind[] = ['percent_off', 'buy_get', 'amount_off'];
const scopes: PromotionScope[] = ['all', 'categories', 'items'];
// Sunday first, as the API counts them; the names come from the language.
const weekdays = [0, 1, 2, 3, 4, 5, 6];
const dayName = (day: number, language: string) =>
  new Intl.DateTimeFormat(language === 'ar' ? 'ar' : 'en-GB', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2026, 9, 11 + day)));

interface FormState {
  name: { en: string; ar: string };
  kind: PromotionKind;
  value: string;
  buyQuantity: string;
  getQuantity: string;
  appliesTo: PromotionScope;
  categoryIds: string[];
  itemIds: string[];
  branchIds: string[];
  days: number[];
  startTime: string;
  endTime: string;
  startsOn: string;
  endsOn: string;
  code: string;
  isActive: boolean;
}

const empty: FormState = {
  name: { en: '', ar: '' },
  kind: 'percent_off',
  value: '',
  buyQuantity: '2',
  getQuantity: '1',
  appliesTo: 'all',
  categoryIds: [],
  itemIds: [],
  branchIds: [],
  days: [],
  startTime: '',
  endTime: '',
  startsOn: '',
  endsOn: '',
  code: '',
  isActive: true,
};

const fromPromotion = (promotion: Promotion): FormState => ({
  name: { ...promotion.name },
  kind: promotion.kind,
  value: promotion.value ?? '',
  buyQuantity: String(promotion.buyQuantity ?? 2),
  getQuantity: String(promotion.getQuantity ?? 1),
  appliesTo: promotion.appliesTo,
  categoryIds: promotion.categoryIds,
  itemIds: promotion.itemIds,
  branchIds: promotion.branchIds,
  days: promotion.days,
  startTime: promotion.startTime ?? '',
  endTime: promotion.endTime ?? '',
  startsOn: promotion.startsOn ?? '',
  endsOn: promotion.endsOn ?? '',
  code: promotion.code ?? '',
  isActive: promotion.isActive,
});

const toRequest = (form: FormState, sortOrder: number): PromotionInput => ({
  name: { en: form.name.en.trim(), ar: form.name.ar.trim() },
  kind: form.kind,
  value: form.kind === 'buy_get' ? null : form.value.trim(),
  buyQuantity: form.kind === 'buy_get' ? Number(form.buyQuantity) : null,
  getQuantity: form.kind === 'buy_get' ? Number(form.getQuantity) : null,
  appliesTo: form.appliesTo,
  categoryIds: form.appliesTo === 'categories' ? form.categoryIds : [],
  itemIds: form.appliesTo === 'items' ? form.itemIds : [],
  branchIds: form.branchIds,
  days: form.days,
  startTime: form.startTime || null,
  endTime: form.endTime || null,
  startsOn: form.startsOn || null,
  endsOn: form.endsOn || null,
  code: form.code.trim() || null,
  sortOrder,
  isActive: form.isActive,
});

const toggle = <T,>(list: T[], value: T, on: boolean) =>
  on ? [...list, value] : list.filter((entry) => entry !== value);

function CheckList({
  legend,
  options,
  chosen,
  onChange,
  error,
}: {
  legend: string;
  options: { id: string; label: string }[];
  chosen: string[];
  onChange: (next: string[]) => void;
  error?: string;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium text-slate-700">{legend}</legend>
      <div className="flex max-h-48 flex-wrap gap-x-4 gap-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
        {options.map((option) => (
          <label key={option.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={chosen.includes(option.id)}
              onChange={(event) => onChange(toggle(chosen, option.id, event.target.checked))}
            />
            {option.label}
          </label>
        ))}
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </fieldset>
  );
}

interface PromotionFormProps {
  brandId: string;
  existing: Promotion | null;
  nextSortOrder: number;
  onDone: () => void;
}

// A promotion: what it gives, on what, where and when (docs/specs/021-promotions.md).
function PromotionForm({ brandId, existing, nextSortOrder, onDone }: PromotionFormProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { branches } = useMenuContext();
  const [form, setForm] = useState<FormState>(() => (existing ? fromPromotion(existing) : empty));
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const prefix = existing ? `promotion-${existing.id}` : 'promotion-new';
  const set = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));

  const categories = useQuery({
    queryKey: menuKeys.categories(brandId),
    queryFn: () => listCategories(brandId),
  });
  const items = useQuery({
    queryKey: menuKeys.allItems(brandId),
    queryFn: () => listAllItems(brandId),
    enabled: form.appliesTo === 'items',
  });

  const save = useMutation({
    mutationFn: (body: PromotionInput) =>
      existing ? updatePromotion(existing.id, body) : createPromotion({ ...body, brandId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: promotionKeys.list(brandId) });
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
    const body = toRequest(form, existing?.sortOrder ?? nextSortOrder);
    const parsed = updatePromotionRequestSchema.safeParse(body);
    const found = parsed.success ? {} : fieldsFromIssues(parsed.error.issues);
    setProblems(found);
    if (!parsed.success) return;
    save.mutate(body);
  }
  const error = (field: string) => (problems[field] ? messageFor(problems[field], t) : undefined);
  const id = (field: string) => `${prefix}-${field}`;
  const small = (field: keyof FormState, label: string, input: ReactNode) => (
    <FormField id={id(field)} label={label} error={error(field)}>
      {input}
    </FormField>
  );

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 className="font-semibold">
        {existing ? t('menu.promotions.edit') : t('menu.promotions.add')}
      </h2>
      <BilingualNameFields
        idPrefix={prefix}
        value={form.name}
        onChange={(name) => set({ name })}
        errors={{ en: error('name.en'), ar: error('name.ar') }}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {small(
          'kind',
          t('menu.promotions.kind'),
          <select
            {...fieldAttributes(id('kind'), {})}
            value={form.kind}
            onChange={(event) => set({ kind: event.target.value as PromotionKind })}
            className={fieldClass}
          >
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {t(`menu.promotions.kinds.${kind}`)}
              </option>
            ))}
          </select>,
        )}
        {form.kind === 'percent_off' &&
          small(
            'value',
            t('menu.promotions.percent'),
            <input
              {...fieldAttributes(id('value'), { error: Boolean(error('value')) })}
              type="text"
              inputMode="decimal"
              dir="ltr"
              value={form.value}
              onChange={(event) => set({ value: normalizeNumberInput(event.target.value) })}
              className={fieldClass}
            />,
          )}
        {form.kind === 'amount_off' &&
          small(
            'value',
            t('menu.promotions.amount'),
            <PriceInput
              {...fieldAttributes(id('value'), { error: Boolean(error('value')) })}
              value={form.value}
              onChange={(value) => set({ value })}
            />,
          )}
        {form.kind === 'buy_get' && (
          <>
            {small(
              'buyQuantity',
              t('menu.promotions.buy'),
              <input
                {...fieldAttributes(id('buyQuantity'), { error: Boolean(error('buyQuantity')) })}
                type="text"
                inputMode="numeric"
                dir="ltr"
                value={form.buyQuantity}
                onChange={(event) => set({ buyQuantity: normalizeNumberInput(event.target.value) })}
                className={fieldClass}
              />,
            )}
            {small(
              'getQuantity',
              t('menu.promotions.get'),
              <input
                {...fieldAttributes(id('getQuantity'), { error: Boolean(error('getQuantity')) })}
                type="text"
                inputMode="numeric"
                dir="ltr"
                value={form.getQuantity}
                onChange={(event) => set({ getQuantity: normalizeNumberInput(event.target.value) })}
                className={fieldClass}
              />,
            )}
          </>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">
          {t('menu.promotions.appliesTo')}
        </legend>
        <div className="flex flex-wrap gap-4">
          {scopes.map((scope) => (
            <label key={scope} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={form.appliesTo === scope}
                onChange={() => set({ appliesTo: scope })}
              />
              {t(`menu.promotions.scopes.${scope}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {form.appliesTo === 'categories' && (
        <CheckList
          legend={t('menu.promotions.categories')}
          options={(categories.data ?? []).map((row) => ({
            id: row.id,
            label: localize(row.name, i18n.language),
          }))}
          chosen={form.categoryIds}
          onChange={(categoryIds) => set({ categoryIds })}
          error={error('categoryIds')}
        />
      )}
      {form.appliesTo === 'items' && (
        <CheckList
          legend={t('menu.promotions.items')}
          options={(items.data ?? []).map((row) => ({
            id: row.id,
            label: localize(row.name, i18n.language),
          }))}
          chosen={form.itemIds}
          onChange={(itemIds) => set({ itemIds })}
          error={error('itemIds')}
        />
      )}

      <CheckList
        legend={t('menu.promotions.branches')}
        options={branches.map((row) => ({ id: row.id, label: localize(row.name, i18n.language) }))}
        chosen={form.branchIds}
        onChange={(branchIds) => set({ branchIds })}
      />
      <p className="-mt-2 text-xs text-slate-500">{t('menu.promotions.branchesHint')}</p>

      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-slate-700">{t('menu.promotions.days')}</legend>
        <div className="flex flex-wrap gap-3">
          {weekdays.map((day) => (
            <label key={day} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={form.days.includes(day)}
                onChange={(event) => set({ days: toggle(form.days, day, event.target.checked) })}
              />
              {dayName(day, i18n.language)}
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-500">{t('menu.promotions.daysHint')}</p>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-4">
        {small(
          'startTime',
          t('menu.promotions.startTime'),
          <input
            {...fieldAttributes(id('startTime'), { error: Boolean(error('startTime')) })}
            type="time"
            value={form.startTime}
            onChange={(event) => set({ startTime: event.target.value })}
            className={fieldClass}
          />,
        )}
        {small(
          'endTime',
          t('menu.promotions.endTime'),
          <input
            {...fieldAttributes(id('endTime'), { error: Boolean(error('endTime')) })}
            type="time"
            value={form.endTime}
            onChange={(event) => set({ endTime: event.target.value })}
            className={fieldClass}
          />,
        )}
        {small(
          'startsOn',
          t('menu.promotions.startsOn'),
          <input
            {...fieldAttributes(id('startsOn'), {})}
            type="date"
            value={form.startsOn}
            onChange={(event) => set({ startsOn: event.target.value })}
            className={fieldClass}
          />,
        )}
        {small(
          'endsOn',
          t('menu.promotions.endsOn'),
          <input
            {...fieldAttributes(id('endsOn'), { error: Boolean(error('endsOn')) })}
            type="date"
            value={form.endsOn}
            onChange={(event) => set({ endsOn: event.target.value })}
            className={fieldClass}
          />,
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          id={id('code')}
          label={t('menu.promotions.code')}
          hint={t('menu.promotions.codeHint')}
          error={error('code')}
        >
          <input
            {...fieldAttributes(id('code'), { hint: true, error: Boolean(error('code')) })}
            type="text"
            dir="ltr"
            autoComplete="off"
            value={form.code}
            onChange={(event) => set({ code: event.target.value.toUpperCase() })}
            className={`${fieldClass} uppercase`}
          />
        </FormField>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => set({ isActive: event.target.checked })}
          />
          {t('menu.promotions.active')}
        </label>
      </div>

      {formProblem && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(formProblem, t)}
        </p>
      )}
      <div className="flex gap-3">
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

// What a promotion gives, on what, and when, in a few words.
function describe(promotion: Promotion, t: TFunction, language: string) {
  const gives =
    promotion.kind === 'percent_off'
      ? t('menu.promotions.gives.percent_off', { value: Number(promotion.value ?? '0') })
      : promotion.kind === 'amount_off'
        ? t('menu.promotions.gives.amount_off', { value: promotion.value })
        : t('menu.promotions.gives.buy_get', {
            buy: promotion.buyQuantity,
            get: promotion.getQuantity,
          });
  const on = t(`menu.promotions.on.${promotion.appliesTo}`, {
    count:
      promotion.appliesTo === 'items' ? promotion.itemIds.length : promotion.categoryIds.length,
  });
  const when = [
    promotion.days.length > 0
      ? promotion.days.map((day) => dayName(day, language)).join(' ')
      : null,
    promotion.startTime && promotion.endTime ? `${promotion.startTime}–${promotion.endTime}` : null,
    promotion.startsOn ? formatDate(promotion.startsOn, language) : null,
    promotion.endsOn ? `→ ${formatDate(promotion.endsOn, language)}` : null,
  ].filter(Boolean);
  return { gives, on, when: when.join(' · ') };
}

// The brand's promotions and the form to add or change one. See docs/specs/021-promotions.md.
export function PromotionsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { brandId } = useMenuContext();
  const canWrite = user?.permissions.includes('promotions:write') ?? false;
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);

  const promotions = useQuery({
    queryKey: promotionKeys.list(brandId),
    queryFn: () => listPromotions(brandId),
  });
  const nextSortOrder = (promotions.data ?? []).reduce(
    (top, row) => Math.max(top, row.sortOrder + 1),
    0,
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('menu.promotions.intro')}</p>
      {canWrite && editing === null && (
        <button type="button" onClick={() => setEditing('new')} className={primaryButtonClass}>
          {t('menu.promotions.add')}
        </button>
      )}
      {editing === 'new' && (
        <PromotionForm
          brandId={brandId}
          existing={null}
          nextSortOrder={nextSortOrder}
          onDone={() => setEditing(null)}
        />
      )}

      {promotions.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {promotions.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {promotions.data?.length === 0 && (
        <p className="text-sm text-slate-500">{t('menu.promotions.empty')}</p>
      )}

      <ul className="space-y-2">
        {promotions.data?.map((promotion) => {
          const name = localize(promotion.name, i18n.language);
          const text = describe(promotion, t, i18n.language);
          return (
            <li key={promotion.id} className="rounded-lg border border-slate-200 bg-white p-3">
              {editing !== null && editing !== 'new' && editing.id === promotion.id ? (
                <PromotionForm
                  brandId={brandId}
                  existing={promotion}
                  nextSortOrder={nextSortOrder}
                  onDone={() => setEditing(null)}
                />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {name}
                      {promotion.code && (
                        <span className="ms-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                          <bdi dir="ltr">{promotion.code}</bdi>
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-600">
                      {text.gives} · {text.on}
                      {text.when && ` · ${text.when}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ActiveBadge isActive={promotion.isActive} />
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => setEditing(promotion)}
                        aria-label={t('menu.promotions.editFor', { name })}
                        className={secondaryButtonClass}
                      >
                        {t('menu.promotions.edit')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
