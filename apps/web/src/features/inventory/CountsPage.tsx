import { startCountRequestSchema, type StockCountSummary } from '@pos/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Dialog } from '../../components/Dialog';
import {
  fieldClass,
  FormField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { Price } from '../../components/Price';
import { formatDateTime } from '../../i18n/format';
import { localize } from '../../i18n/localize';
import { fieldsFromIssues, messageFor, problemsFrom } from '../../lib/error-messages';
import { countKeys, inventoryKeys, listCounts, listIngredients, startCount } from './inventory-api';
import { useInventoryContext } from './InventoryLayout';

const statusClass: Record<StockCountSummary['status'], string> = {
  open: 'bg-amber-100 text-amber-900',
  finished: 'bg-emerald-100 text-emerald-900',
  cancelled: 'bg-slate-200 text-slate-700',
};

export function CountStatusBadge({ status }: { status: StockCountSummary['status'] }) {
  const { t } = useTranslation();
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass[status]}`}>
      {t(`inventory.counts.statuses.${status}`)}
    </span>
  );
}

interface NewCountDialogProps {
  brandId: string;
  branchId: string;
  onCancel: () => void;
}

// Starts a count of every ingredient, or of a choice of them (spec 015, rules 1 and 2).
function NewCountDialog({ brandId, branchId, onCancel }: NewCountDialogProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [everything, setEverything] = useState(true);
  const [chosen, setChosen] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);

  const ingredients = useQuery({
    queryKey: inventoryKeys.ingredients(brandId),
    queryFn: () => listIngredients(brandId),
  });
  const active = (ingredients.data ?? []).filter((ingredient) => ingredient.isActive);

  const start = useMutation({
    mutationFn: (body: Parameters<typeof startCount>[0]) => startCount(body),
    onSuccess: async (count) => {
      await queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      void navigate(`${count.id}?branchId=${branchId}`);
    },
    onError: (error) => {
      const found = problemsFrom(error);
      setProblems(found.fields);
      setFormProblem(found.form ?? found.fields.ingredientIds ?? null);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormProblem(null);
    if (!everything && chosen.length === 0) {
      setFormProblem('INGREDIENT_REQUIRED');
      return;
    }
    const body = { branchId, note, ...(everything ? {} : { ingredientIds: chosen }) };
    const result = startCountRequestSchema.safeParse(body);
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    setProblems(found);
    if (!result.success) return;
    start.mutate(body);
  }

  return (
    <Dialog title={t('inventory.counts.new')} onClose={onCancel}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">
            {t('inventory.counts.what')}
          </legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={everything} onChange={() => setEverything(true)} />
            {t('inventory.counts.everything', { count: active.length })}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={!everything} onChange={() => setEverything(false)} />
            {t('inventory.counts.some')}
          </label>
        </fieldset>

        {!everything && (
          <fieldset className="max-h-60 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-3">
            <legend className="sr-only">{t('inventory.counts.chooseIngredients')}</legend>
            {active.map((ingredient) => (
              <label key={ingredient.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={chosen.includes(ingredient.id)}
                  onChange={(event) =>
                    setChosen((current) =>
                      event.target.checked
                        ? [...current, ingredient.id]
                        : current.filter((id) => id !== ingredient.id),
                    )
                  }
                />
                {localize(ingredient.name, i18n.language)}
              </label>
            ))}
          </fieldset>
        )}

        <FormField
          id="count-note"
          label={t('inventory.counts.note')}
          error={problems.note ? messageFor(problems.note, t) : undefined}
        >
          <input
            id="count-note"
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={fieldClass}
          />
        </FormField>

        {formProblem && (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {messageFor(formProblem, t)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={start.isPending} className={primaryButtonClass}>
            {t('inventory.counts.start')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// The counts of a branch, the open one first, and the way to start one.
// See docs/specs/015-stock-counts.md.
export function CountsPage() {
  const { t, i18n } = useTranslation();
  const { brandId, branches, canMoveStock } = useInventoryContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const branchId =
    branches.find((branch) => branch.id === searchParams.get('branchId'))?.id ??
    branches[0]?.id ??
    null;
  const [creating, setCreating] = useState(false);

  const counts = useQuery({
    queryKey: countKeys.list(branchId ?? ''),
    queryFn: () => listCounts(branchId ?? ''),
    enabled: Boolean(branchId),
  });
  const hasOpen = counts.data?.some((count) => count.status === 'open') ?? false;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('inventory.counts.intro')}</p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        {branches.length > 0 && (
          <label className="block text-sm font-medium text-slate-700">
            {t('inventory.stock.branch')}
            <select
              value={branchId ?? ''}
              onChange={(event) =>
                setSearchParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set('branchId', event.target.value);
                  return next;
                })
              }
              className={fieldClass}
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {localize(branch.name, i18n.language)}
                </option>
              ))}
            </select>
          </label>
        )}
        {branchId && canMoveStock && counts.data && !hasOpen && (
          <button type="button" onClick={() => setCreating(true)} className={primaryButtonClass}>
            {t('inventory.counts.new')}
          </button>
        )}
      </div>

      {counts.isPending && branchId && (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      )}
      {counts.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {counts.data?.length === 0 && (
        <p className="text-sm text-slate-500">{t('inventory.counts.empty')}</p>
      )}

      {counts.data && counts.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="py-2 pe-3 text-start font-medium">{t('inventory.counts.number')}</th>
                <th className="py-2 pe-3 text-start font-medium">{t('inventory.counts.status')}</th>
                <th className="py-2 pe-3 text-start font-medium">
                  {t('inventory.counts.started')}
                </th>
                <th className="py-2 pe-3 text-end font-medium">{t('inventory.counts.counted')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('inventory.counts.lost')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('inventory.counts.found')}</th>
                <th className="py-2 text-end font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {counts.data.map((count) => (
                <tr key={count.id} className="border-b border-slate-100">
                  <td className="py-2 pe-3 font-medium">#{count.number}</td>
                  <td className="py-2 pe-3">
                    <CountStatusBadge status={count.status} />
                  </td>
                  <td className="py-2 pe-3 whitespace-nowrap">
                    {formatDateTime(count.startedAt, i18n.language)}
                    <span className="block text-xs text-slate-500">
                      {count.startedByName ?? '–'}
                    </span>
                  </td>
                  <td className="py-2 pe-3 text-end whitespace-nowrap">
                    {t('inventory.counts.ofLines', {
                      counted: count.countedCount,
                      total: count.lineCount,
                    })}
                  </td>
                  <td className="py-2 pe-3 text-end text-red-700">
                    <Price value={count.lostValue} />
                  </td>
                  <td className="py-2 pe-3 text-end text-emerald-800">
                    <Price value={count.foundValue} />
                  </td>
                  <td className="py-2 text-end">
                    <Link
                      to={`${count.id}?branchId=${branchId ?? ''}`}
                      aria-label={t('inventory.counts.openFor', { number: count.number })}
                      className="text-xs text-slate-600 underline"
                    >
                      {count.status === 'open' && canMoveStock
                        ? t('inventory.counts.continue')
                        : t('inventory.counts.open')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && branchId && (
        <NewCountDialog brandId={brandId} branchId={branchId} onCancel={() => setCreating(false)} />
      )}
    </div>
  );
}
