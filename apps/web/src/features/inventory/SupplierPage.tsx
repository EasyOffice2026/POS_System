import {
  type Ingredient,
  MAX_SUPPLIER_PRICES,
  putSupplierPricesRequestSchema,
  type SupplierDetail,
  toMils,
} from '@pos/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router';
import { ActiveBadge } from '../../components/ActiveBadge';
import { compactFieldClass, primaryButtonClass, secondaryButtonClass } from '../../components/form';
import { Price, PriceInput } from '../../components/Price';
import { localize } from '../../i18n/localize';
import { fieldsFromIssues, messageFor, problemsFrom } from '../../lib/error-messages';
import {
  getSupplier,
  inventoryKeys,
  listIngredients,
  putSupplierPrices,
  supplierKeys,
  updateSupplier,
} from './inventory-api';
import { useInventoryContext } from './InventoryLayout';
import { SupplierForm } from './SupplierForm';

// One supplier: how to reach them, and their price list. See docs/specs/017-suppliers.md.
export function SupplierPage() {
  const { t } = useTranslation();
  // A group admin's brand is in the address; the way back keeps it.
  const { search } = useLocation();
  const { id = '' } = useParams();
  const supplier = useQuery({ queryKey: supplierKeys.one(id), queryFn: () => getSupplier(id) });

  return (
    <div className="space-y-4">
      <Link
        to={{ pathname: '..', search }}
        relative="path"
        className="text-sm text-slate-600 underline"
      >
        {t('inventory.suppliers.back')}
      </Link>
      {supplier.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {supplier.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {supplier.data && <SupplierSheet key={supplier.data.id} supplier={supplier.data} />}
    </div>
  );
}

function SupplierSheet({ supplier }: { supplier: SupplierDetail }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { canEditSuppliers } = useInventoryContext();
  const [editing, setEditing] = useState(false);

  const toggle = useMutation({
    mutationFn: () => updateSupplier(supplier.id, { isActive: !supplier.isActive }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(supplierKeys.one(supplier.id), saved);
      await queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });

  const detail = (label: string, value: string | null, ltr = false) =>
    value && (
      <div>
        <dt className="text-xs text-slate-500">{label}</dt>
        <dd>{ltr ? <bdi dir="ltr">{value}</bdi> : <bdi>{value}</bdi>}</dd>
      </div>
    );

  return (
    <div className="space-y-6">
      {editing ? (
        <SupplierForm
          brandId={supplier.brandId}
          existing={supplier}
          onDone={(saved) => {
            if (saved) queryClient.setQueryData(supplierKeys.one(supplier.id), saved);
            setEditing(false);
          }}
        />
      ) : (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold">
                <bdi>{supplier.name}</bdi>
              </h2>
              <ActiveBadge isActive={supplier.isActive} />
            </div>
            {canEditSuppliers && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className={secondaryButtonClass}
                >
                  {t('inventory.suppliers.edit')}
                </button>
                <button
                  type="button"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate()}
                  className={secondaryButtonClass}
                >
                  {supplier.isActive ? t('common.deactivate') : t('common.activate')}
                </button>
              </div>
            )}
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {detail(t('inventory.suppliers.contactName'), supplier.contactName)}
            {detail(t('inventory.suppliers.phone'), supplier.phone, true)}
            {detail(t('inventory.suppliers.email'), supplier.email, true)}
            <div>
              <dt className="text-xs text-slate-500">{t('inventory.suppliers.paymentDays')}</dt>
              <dd>
                {supplier.paymentDays === 0
                  ? t('inventory.suppliers.cash')
                  : t('inventory.suppliers.days', { count: supplier.paymentDays })}
              </dd>
            </div>
            {detail(t('inventory.suppliers.address'), supplier.address)}
            {detail(t('inventory.suppliers.notes'), supplier.notes)}
          </dl>
        </section>
      )}

      <PriceList supplier={supplier} readOnly={!canEditSuppliers} />
    </div>
  );
}

interface Line {
  ingredientId: string;
  price: string;
}

// The supplier's price per unit of each ingredient, next to the ingredient's cost (rules 3, 4).
function PriceList({ supplier, readOnly }: { supplier: SupplierDetail; readOnly: boolean }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  // The ingredients of the supplier's own brand, whatever brand the address names.
  const { brandId } = supplier;
  const [lines, setLines] = useState<Line[]>(() =>
    supplier.prices.map((line) => ({ ingredientId: line.ingredient.id, price: line.price })),
  );
  const [adding, setAdding] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const ingredients = useQuery({
    queryKey: inventoryKeys.ingredients(brandId),
    queryFn: () => listIngredients(brandId),
  });
  const ingredientOf = new Map<string, Ingredient>(
    (ingredients.data ?? []).map((ingredient) => [ingredient.id, ingredient]),
  );
  for (const line of supplier.prices) ingredientOf.set(line.ingredient.id, line.ingredient);
  const used = new Set(lines.map((line) => line.ingredientId));
  const free = (ingredients.data ?? []).filter(
    (ingredient) => ingredient.isActive && !used.has(ingredient.id),
  );

  const save = useMutation({
    mutationFn: (body: Line[]) => putSupplierPrices(supplier.id, body),
    onSuccess: (result) => {
      queryClient.setQueryData(supplierKeys.one(supplier.id), result);
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      setLines(
        result.prices.map((line) => ({ ingredientId: line.ingredient.id, price: line.price })),
      );
      setSaved(true);
    },
    onError: (error) => {
      const found = problemsFrom(error);
      setErrors(found.fields);
      setForm(found.form ?? found.fields.prices ?? null);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    setForm(null);
    const parsed = putSupplierPricesRequestSchema.safeParse({ prices: lines });
    const found = parsed.success ? {} : fieldsFromIssues(parsed.error.issues);
    setErrors(found);
    if (!parsed.success) {
      setForm(found.prices ?? null);
      return;
    }
    save.mutate(parsed.data.prices);
  }

  // How the supplier's price compares with the ingredient's cost, in percent.
  const compare = (price: string, ingredient: Ingredient | undefined) => {
    if (!ingredient || !/^\d+(\.\d{1,3})?$/.test(price.trim())) return null;
    const cost = toMils(ingredient.costPerUnit);
    if (cost === 0) return null;
    return Math.round(((toMils(price.trim()) - cost) * 100) / cost);
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3">
      <h2 className="text-lg font-semibold">{t('inventory.suppliers.prices')}</h2>
      <p className="text-sm text-slate-600">{t('inventory.suppliers.pricesIntro')}</p>
      {saved && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {t('inventory.suppliers.pricesSaved')}
        </p>
      )}
      {form && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(form, t)}
        </p>
      )}
      {lines.length === 0 ? (
        <p className="text-sm text-slate-500">{t('inventory.suppliers.noPrices')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="py-2 pe-3 text-start font-medium">
                  {t('inventory.stock.ingredient')}
                </th>
                <th className="py-2 pe-3 text-start font-medium">
                  {t('inventory.suppliers.price')}
                </th>
                <th className="py-2 pe-3 text-end font-medium">
                  {t('inventory.suppliers.ourCost')}
                </th>
                {!readOnly && <th className="py-2 text-end font-medium"></th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const ingredient = ingredientOf.get(line.ingredientId);
                const name = ingredient ? localize(ingredient.name, i18n.language) : '';
                const unit = ingredient ? t(`inventory.units.${ingredient.unit}`) : '';
                const id = `price-${line.ingredientId}`;
                const error = errors[`prices.${index}.price`];
                const percent = compare(line.price, ingredient);
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
                          <Price value={line.price} /> / {unit}
                        </span>
                      ) : (
                        <>
                          <PriceInput
                            id={id}
                            value={line.price}
                            onChange={(value) => {
                              setSaved(false);
                              setLines((current) =>
                                current.map((entry, at) =>
                                  at === index ? { ...entry, price: value } : entry,
                                ),
                              );
                            }}
                            aria-invalid={error ? true : undefined}
                            aria-describedby={error ? `${id}-error` : undefined}
                            className={`${compactFieldClass} w-28`}
                          />{' '}
                          {t('inventory.suppliers.perUnit', { unit })}
                          {error && (
                            <p id={`${id}-error`} className="mt-1 text-xs text-red-700">
                              {messageFor(error, t)}
                            </p>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-2 pe-3 text-end whitespace-nowrap">
                      {ingredient && <Price value={ingredient.costPerUnit} />}
                      {percent !== null && percent !== 0 && (
                        <span
                          className={`block text-xs ${percent > 0 ? 'text-red-700' : 'text-emerald-800'}`}
                        >
                          {percent > 0
                            ? t('inventory.suppliers.dearer', { percent })
                            : t('inventory.suppliers.cheaper', { percent: -percent })}
                        </span>
                      )}
                    </td>
                    {!readOnly && (
                      <td className="py-2 text-end">
                        <button
                          type="button"
                          onClick={() => {
                            setSaved(false);
                            setLines((current) => current.filter((_, at) => at !== index));
                          }}
                          aria-label={t('inventory.suppliers.removeFor', { name })}
                          className="text-xs text-slate-600 underline"
                        >
                          {t('inventory.suppliers.remove')}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!readOnly && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm font-medium text-slate-700">
            {t('inventory.suppliers.addPrice')}
            <select
              value={adding}
              onChange={(event) => setAdding(event.target.value)}
              disabled={free.length === 0 || lines.length >= MAX_SUPPLIER_PRICES}
              className={`${compactFieldClass} mt-1 block`}
            >
              <option value="">{t('inventory.suppliers.choose')}</option>
              {free.map((ingredient) => (
                <option key={ingredient.id} value={ingredient.id}>
                  {localize(ingredient.name, i18n.language)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!adding}
            onClick={() => {
              setSaved(false);
              setLines((current) => [...current, { ingredientId: adding, price: '' }]);
              setAdding('');
            }}
            className={secondaryButtonClass}
          >
            {t('inventory.suppliers.addButton')}
          </button>
          <span className="flex-1" />
          <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
            {t('inventory.suppliers.savePrices')}
          </button>
        </div>
      )}
    </form>
  );
}
