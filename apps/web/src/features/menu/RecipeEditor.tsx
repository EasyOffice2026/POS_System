import {
  fromMils,
  type Ingredient,
  MAX_RECIPE_LINES,
  putRecipeRequestSchema,
  type Recipe,
  toMils,
} from '@pos/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { compactFieldClass, primaryButtonClass, secondaryButtonClass } from '../../components/form';
import { Price, PriceInput } from '../../components/Price';
import { localize } from '../../i18n/localize';
import { messageFor, problemsFrom } from '../../lib/error-messages';
import { inventoryKeys, listIngredients } from '../inventory/inventory-api';
import { getRecipe, menuKeys, putRecipe, type RecipeOwner } from './menu-api';

interface RecipeEditorProps {
  brandId: string;
  owner: RecipeOwner;
  // The price of the dish, to say what share of it the ingredients cost.
  price?: string;
  readOnly: boolean;
}

// The recipe of a dish or a modifier: its ingredients, how much of each, and what they cost.
// See docs/specs/013-recipes.md.
export function RecipeEditor({ brandId, owner, price, readOnly }: RecipeEditorProps) {
  const { t } = useTranslation();
  const recipe = useQuery({ queryKey: menuKeys.recipe(owner), queryFn: () => getRecipe(owner) });
  const ingredients = useQuery({
    queryKey: inventoryKeys.ingredients(brandId),
    queryFn: () => listIngredients(brandId),
  });

  if (recipe.isError || ingredients.isError) {
    return (
      <p role="alert" className="text-sm text-red-700">
        {t('common.loadError')}
      </p>
    );
  }
  if (!recipe.data || !ingredients.data) {
    return <p className="text-sm text-slate-500">{t('common.loading')}</p>;
  }
  return (
    <RecipeForm
      owner={owner}
      recipe={recipe.data}
      ingredients={ingredients.data}
      price={price}
      readOnly={readOnly}
    />
  );
}

interface Line {
  ingredientId: string;
  quantity: string;
}

interface RecipeFormProps {
  owner: RecipeOwner;
  recipe: Recipe;
  ingredients: Ingredient[];
  price: string | undefined;
  readOnly: boolean;
}

const costOf = (quantity: string, ingredient: Ingredient | undefined): number => {
  const parsed = Number(quantity);
  if (!ingredient || !Number.isFinite(parsed)) return 0;
  return Math.round(parsed * toMils(ingredient.costPerUnit));
};

function RecipeForm({ owner, recipe, ingredients, price, readOnly }: RecipeFormProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<Line[]>(() =>
    recipe.lines.map((line) => ({ ingredientId: line.ingredient.id, quantity: line.quantity })),
  );
  const [adding, setAdding] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const ingredientOf = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  // An ingredient that was made inactive stays on the recipe until it is taken off.
  for (const line of recipe.lines) ingredientOf.set(line.ingredient.id, line.ingredient);
  const nameOf = (id: string) => {
    const ingredient = ingredientOf.get(id);
    return ingredient ? localize(ingredient.name, i18n.language) : '';
  };
  const used = new Set(lines.map((line) => line.ingredientId));
  const free = ingredients.filter((ingredient) => ingredient.isActive && !used.has(ingredient.id));

  const total = lines.reduce(
    (sum, line) => sum + costOf(line.quantity, ingredientOf.get(line.ingredientId)),
    0,
  );
  const share =
    price && toMils(price) > 0 ? Math.round((total * 100) / toMils(price)).toString() : null;

  const save = useMutation({
    mutationFn: (body: { lines: Line[] }) => putRecipe(owner, body),
    onSuccess: (result) => {
      queryClient.setQueryData(menuKeys.recipe(owner), result);
      setLines(
        result.lines.map((line) => ({ ingredientId: line.ingredient.id, quantity: line.quantity })),
      );
      setSaved(true);
    },
    onError: (error) => {
      const problems = problemsFrom(error);
      setErrors(problems.fields);
      // A problem on a line that is not its quantity (an ingredient gone) is said once, on top.
      setForm(
        problems.form ??
          Object.entries(problems.fields).find(([path]) => !path.endsWith('.quantity'))?.[1] ??
          null,
      );
    },
  });

  function change(index: number, quantity: string) {
    setSaved(false);
    setLines((current) => current.map((line, at) => (at === index ? { ...line, quantity } : line)));
  }

  function add() {
    if (!adding) return;
    setSaved(false);
    setLines((current) => [...current, { ingredientId: adding, quantity: '' }]);
    setAdding('');
  }

  function remove(index: number) {
    setSaved(false);
    setLines((current) => current.filter((_, at) => at !== index));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    setForm(null);
    // Each quantity has to be above 0; the shared rules check the rest.
    const problems: Record<string, string> = {};
    lines.forEach((line, index) => {
      const parsed = Number(line.quantity);
      if (!(parsed > 0)) problems[`lines.${index}.quantity`] = 'RECIPE_QUANTITY_INVALID';
    });
    const parsed = putRecipeRequestSchema.safeParse({ lines });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        problems[issue.path.map(String).join('.')] ??= issue.message;
      }
    }
    setErrors(problems);
    if (!parsed.success || Object.keys(problems).length > 0) {
      setForm(problems.lines ?? null);
      return;
    }
    // The quantities go as the rules wrote them, with three decimals.
    save.mutate(parsed.data);
  }

  const unitOf = (id: string) => {
    const ingredient = ingredientOf.get(id);
    return ingredient ? t(`inventory.units.${ingredient.unit}`) : '';
  };
  const lineError = (index: number) => {
    const code = errors[`lines.${index}.quantity`];
    if (!code) return null;
    return code === 'RECIPE_QUANTITY_INVALID'
      ? t('menu.recipe.quantityInvalid')
      : messageFor(code, t);
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <p className="text-sm text-slate-600">
        {'itemId' in owner ? t('menu.recipe.intro') : t('menu.recipe.modifierIntro')}
      </p>

      {saved && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {t('menu.recipe.saved')}
        </p>
      )}
      {form && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(form, t)}
        </p>
      )}

      {lines.length === 0 ? (
        <p className="text-sm text-slate-500">{t('menu.recipe.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="py-2 pe-3 text-start font-medium">{t('menu.recipe.ingredient')}</th>
                <th className="py-2 pe-3 text-start font-medium">{t('menu.recipe.quantity')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('menu.recipe.cost')}</th>
                {!readOnly && <th className="py-2 text-end font-medium"></th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const name = nameOf(line.ingredientId);
                const error = lineError(index);
                const id = `recipe-${index}-quantity`;
                return (
                  <tr key={line.ingredientId} className="border-b border-slate-100 align-top">
                    <td className="py-2 pe-3">
                      <label htmlFor={id} className="font-medium">
                        {name}
                      </label>
                    </td>
                    <td className="py-2 pe-3 whitespace-nowrap">
                      {readOnly ? (
                        <span>
                          <bdi dir="ltr">{line.quantity}</bdi> {unitOf(line.ingredientId)}
                        </span>
                      ) : (
                        <>
                          <PriceInput
                            id={id}
                            value={line.quantity}
                            onChange={(value) => change(index, value)}
                            aria-invalid={error ? true : undefined}
                            aria-describedby={error ? `${id}-error` : undefined}
                            className={`${compactFieldClass} w-28`}
                          />{' '}
                          {unitOf(line.ingredientId)}
                          {error && (
                            <p id={`${id}-error`} className="mt-1 text-xs text-red-700">
                              {error}
                            </p>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-2 pe-3 text-end whitespace-nowrap">
                      <Price
                        value={fromMils(costOf(line.quantity, ingredientOf.get(line.ingredientId)))}
                      />
                    </td>
                    {!readOnly && (
                      <td className="py-2 text-end">
                        <button
                          type="button"
                          onClick={() => remove(index)}
                          aria-label={t('menu.recipe.removeFor', { name })}
                          className="text-xs text-slate-600 underline"
                        >
                          {t('menu.recipe.remove')}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-medium">
                <td className="py-2 pe-3" colSpan={2}>
                  {t('menu.recipe.total')}
                </td>
                <td className="py-2 pe-3 text-end whitespace-nowrap">
                  <Price value={fromMils(total)} />
                  {share !== null && (
                    <span className="ms-2 text-xs font-normal text-slate-500">
                      {t('menu.recipe.ofPrice', { percent: share })}
                    </span>
                  )}
                </td>
                {!readOnly && <td></td>}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!readOnly && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm font-medium text-slate-700">
            {t('menu.recipe.add')}
            <select
              value={adding}
              onChange={(event) => setAdding(event.target.value)}
              disabled={free.length === 0 || lines.length >= MAX_RECIPE_LINES}
              className={`${compactFieldClass} mt-1 block`}
            >
              <option value="">
                {free.length === 0 ? t('menu.recipe.noIngredients') : t('menu.recipe.choose')}
              </option>
              {free.map((ingredient) => (
                <option key={ingredient.id} value={ingredient.id}>
                  {localize(ingredient.name, i18n.language)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={add} disabled={!adding} className={secondaryButtonClass}>
            {t('menu.recipe.addButton')}
          </button>
          <span className="flex-1" />
          <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
            {t('common.save')}
          </button>
        </div>
      )}
    </form>
  );
}
