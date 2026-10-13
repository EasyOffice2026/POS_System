import {
  createIngredientRequestSchema,
  type Ingredient,
  type StockUnit,
  stockUnits,
  updateIngredientRequestSchema,
} from '@pos/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActiveBadge } from '../../components/ActiveBadge';
import { BilingualNameFields } from '../../components/BilingualNameFields';
import {
  fieldClass,
  FormField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { Price, PriceInput } from '../../components/Price';
import { localize } from '../../i18n/localize';
import { fieldsFromIssues, messageFor, problemsFrom } from '../../lib/error-messages';
import { normalizeNumberInput } from '../../lib/numbers';
import {
  createIngredient,
  inventoryKeys,
  listIngredients,
  updateIngredient,
} from './inventory-api';
import { useInventoryContext } from './InventoryLayout';

interface FormState {
  name: { en: string; ar: string };
  unit: StockUnit;
  costPerUnit: string;
  lowLevel: string;
}

const empty: FormState = { name: { en: '', ar: '' }, unit: 'kg', costPerUnit: '0', lowLevel: '0' };

const fromIngredient = (ingredient: Ingredient): FormState => ({
  name: { ...ingredient.name },
  unit: ingredient.unit,
  costPerUnit: ingredient.costPerUnit,
  lowLevel: ingredient.lowLevel,
});

interface IngredientFormProps {
  brandId: string;
  // The ingredient being changed, or null for a new one.
  existing: Ingredient | null;
  onDone: () => void;
}

function IngredientForm({ brandId, existing, onDone }: IngredientFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => (existing ? fromIngredient(existing) : empty));
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const prefix = existing ? `ingredient-${existing.id}` : 'ingredient-new';

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: { en: form.name.en.trim(), ar: form.name.ar.trim() },
        unit: form.unit,
        costPerUnit: form.costPerUnit.trim(),
        lowLevel: form.lowLevel.trim(),
      };
      return existing
        ? updateIngredient(existing.id, updateIngredientRequestSchema.parse(body))
        : createIngredient({ ...createIngredientRequestSchema.parse(body), brandId });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      onDone();
    },
    onError: (error) => {
      const found = problemsFrom(error, { notFound: 'INGREDIENT_NOT_FOUND' });
      setProblems(found.fields);
      setFormProblem(found.form);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormProblem(null);
    const result = createIngredientRequestSchema.safeParse({
      name: form.name,
      unit: form.unit,
      costPerUnit: form.costPerUnit,
      lowLevel: form.lowLevel,
    });
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
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 className="font-semibold">
        {existing ? t('inventory.ingredients.edit') : t('inventory.ingredients.add')}
      </h2>
      <BilingualNameFields
        idPrefix={prefix}
        value={form.name}
        onChange={(name) => setForm({ ...form, name })}
        errors={{ en: error('name.en'), ar: error('name.ar') }}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField
          id={`${prefix}-unit`}
          label={t('inventory.ingredients.unit')}
          error={error('unit')}
        >
          <select
            id={`${prefix}-unit`}
            value={form.unit}
            onChange={(event) => setForm({ ...form, unit: event.target.value as StockUnit })}
            className={fieldClass}
          >
            {stockUnits.map((unit) => (
              <option key={unit} value={unit}>
                {t(`inventory.units.${unit}`)}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          id={`${prefix}-cost`}
          label={t('inventory.ingredients.cost')}
          error={error('costPerUnit')}
        >
          <PriceInput
            id={`${prefix}-cost`}
            value={form.costPerUnit}
            onChange={(costPerUnit) => setForm({ ...form, costPerUnit })}
          />
        </FormField>
        <FormField
          id={`${prefix}-low`}
          label={t('inventory.ingredients.lowLevel')}
          hint={t('inventory.ingredients.lowLevelHint')}
          error={error('lowLevel')}
        >
          <input
            id={`${prefix}-low`}
            type="text"
            inputMode="decimal"
            dir="ltr"
            value={form.lowLevel}
            onChange={(event) =>
              setForm({ ...form, lowLevel: normalizeNumberInput(event.target.value) })
            }
            className={fieldClass}
          />
        </FormField>
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

// The brand's list of ingredients, searched by name, with a form to add or change one.
export function IngredientsPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { brandId, canEditIngredients } = useInventoryContext();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Ingredient | 'new' | null>(null);

  const ingredients = useQuery({
    queryKey: inventoryKeys.ingredients(brandId, q.trim()),
    queryFn: () => listIngredients(brandId, q.trim()),
  });
  const toggle = useMutation({
    mutationFn: (ingredient: Ingredient) =>
      updateIngredient(ingredient.id, { isActive: !ingredient.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('inventory.ingredients.intro')}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm font-medium text-slate-700">
          {t('inventory.ingredients.search')}
          <input
            type="search"
            dir="auto"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            className={fieldClass}
          />
        </label>
        {canEditIngredients && editing === null && (
          <button type="button" onClick={() => setEditing('new')} className={primaryButtonClass}>
            {t('inventory.ingredients.add')}
          </button>
        )}
      </div>

      {editing === 'new' && (
        <IngredientForm brandId={brandId} existing={null} onDone={() => setEditing(null)} />
      )}

      {ingredients.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {ingredients.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {ingredients.data?.length === 0 && (
        <p className="text-sm text-slate-500">{t('inventory.ingredients.empty')}</p>
      )}

      <ul className="space-y-2">
        {ingredients.data?.map((ingredient) => (
          <li key={ingredient.id} className="rounded-lg border border-slate-200 bg-white p-3">
            {editing !== null && editing !== 'new' && editing.id === ingredient.id ? (
              <IngredientForm
                brandId={brandId}
                existing={ingredient}
                onDone={() => setEditing(null)}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{localize(ingredient.name, i18n.language)}</p>
                  <p className="text-xs text-slate-600">
                    {t(`inventory.units.${ingredient.unit}`)} ·{' '}
                    <Price value={ingredient.costPerUnit} /> {t('inventory.ingredients.perUnit')} ·{' '}
                    {t('inventory.ingredients.lowAt', { level: ingredient.lowLevel })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <ActiveBadge isActive={ingredient.isActive} />
                  {canEditIngredients && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditing(ingredient)}
                        className={secondaryButtonClass}
                        aria-label={`${t('inventory.ingredients.edit')}: ${localize(ingredient.name, i18n.language)}`}
                      >
                        {t('inventory.ingredients.edit')}
                      </button>
                      <button
                        type="button"
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate(ingredient)}
                        className={secondaryButtonClass}
                      >
                        {ingredient.isActive ? t('common.deactivate') : t('common.activate')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
