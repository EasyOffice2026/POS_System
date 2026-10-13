import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { fieldClass } from '../../components/form';
import { formatDateTime } from '../../i18n/format';
import { localize } from '../../i18n/localize';
import { inventoryKeys, listIngredients, listMovements } from './inventory-api';
import { useInventoryContext } from './InventoryLayout';

// The history of a branch's stock, newest first, for one ingredient or all of them.
export function MovementsPage() {
  const { t, i18n } = useTranslation();
  const { brandId, branches } = useInventoryContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const branchId =
    branches.find((branch) => branch.id === searchParams.get('branchId'))?.id ??
    branches[0]?.id ??
    null;
  const ingredientId = searchParams.get('ingredientId') ?? '';

  const ingredients = useQuery({
    queryKey: inventoryKeys.ingredients(brandId),
    queryFn: () => listIngredients(brandId),
  });
  const movements = useQuery({
    queryKey: inventoryKeys.movements(branchId ?? '', ingredientId),
    queryFn: () => listMovements(branchId ?? '', ingredientId),
    enabled: Boolean(branchId),
  });
  const nameOf = new Map(
    (ingredients.data ?? []).map((ingredient) => [
      ingredient.id,
      `${localize(ingredient.name, i18n.language)} (${t(`inventory.units.${ingredient.unit}`)})`,
    ]),
  );
  const setParam = (name: string, value: string) =>
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(name, value);
      else next.delete(name);
      return next;
    });

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('inventory.movements.intro')}</p>
      <div className="flex flex-wrap gap-3">
        <label className="block text-sm font-medium text-slate-700">
          {t('inventory.stock.branch')}
          <select
            value={branchId ?? ''}
            onChange={(event) => setParam('branchId', event.target.value)}
            className={fieldClass}
          >
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {localize(branch.name, i18n.language)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          {t('inventory.stock.ingredient')}
          <select
            value={ingredientId}
            onChange={(event) => setParam('ingredientId', event.target.value)}
            className={fieldClass}
          >
            <option value="">{t('common.all')}</option>
            {ingredients.data?.map((ingredient) => (
              <option key={ingredient.id} value={ingredient.id}>
                {localize(ingredient.name, i18n.language)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {movements.isPending && branchId && (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      )}
      {movements.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {movements.data?.length === 0 && (
        <p className="text-sm text-slate-500">{t('inventory.movements.empty')}</p>
      )}

      {movements.data && movements.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="py-2 pe-3 text-start font-medium">
                  {t('inventory.movements.when')}
                </th>
                <th className="py-2 pe-3 text-start font-medium">
                  {t('inventory.stock.ingredient')}
                </th>
                <th className="py-2 pe-3 text-start font-medium">
                  {t('inventory.movements.kind')}
                </th>
                <th className="py-2 pe-3 text-end font-medium">
                  {t('inventory.movements.change')}
                </th>
                <th className="py-2 pe-3 text-end font-medium">{t('inventory.movements.after')}</th>
                <th className="py-2 text-start font-medium">{t('inventory.movements.who')}</th>
              </tr>
            </thead>
            <tbody>
              {movements.data.map((movement) => (
                <tr key={movement.id} className="border-b border-slate-100">
                  <td className="py-2 pe-3 whitespace-nowrap">
                    {formatDateTime(movement.createdAt, i18n.language)}
                  </td>
                  <td className="py-2 pe-3">{nameOf.get(movement.ingredientId) ?? '…'}</td>
                  <td className="py-2 pe-3">{t(`inventory.movements.kinds.${movement.kind}`)}</td>
                  <td
                    className={`py-2 pe-3 text-end whitespace-nowrap ${movement.quantity.startsWith('-') ? 'text-red-700' : 'text-emerald-800'}`}
                  >
                    <bdi dir="ltr">
                      {movement.quantity.startsWith('-')
                        ? movement.quantity
                        : `+${movement.quantity}`}
                    </bdi>
                  </td>
                  <td className="py-2 pe-3 text-end whitespace-nowrap">
                    <bdi dir="ltr">{movement.quantityAfter}</bdi>
                  </td>
                  <td className="py-2">
                    {movement.byName ?? '–'}
                    {movement.note && (
                      <span className="block text-xs text-slate-500">{movement.note}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
