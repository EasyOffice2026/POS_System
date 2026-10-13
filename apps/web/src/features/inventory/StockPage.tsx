import { type BranchStock, createMovementRequestSchema, type MovementKind } from '@pos/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { Dialog } from '../../components/Dialog';
import {
  fieldClass,
  FormField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { Price } from '../../components/Price';
import { localize } from '../../i18n/localize';
import { fieldsFromIssues, messageFor, problemsFrom } from '../../lib/error-messages';
import { normalizeNumberInput } from '../../lib/numbers';
import { inventoryKeys, listStock, recordMovement, setLowLevel } from './inventory-api';
import { useInventoryContext } from './InventoryLayout';

type ManualKind = 'received' | 'adjustment' | 'waste';

interface MovementDialogProps {
  stock: BranchStock;
  kind: ManualKind;
  onDone: () => void;
  onCancel: () => void;
}

// Goods received, a correction to what was counted, or waste (spec 012, rule 3).
function MovementDialog({ stock, kind, onDone, onCancel }: MovementDialogProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(kind === 'adjustment' ? stock.quantity : '');
  const [note, setNote] = useState('');
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const name = localize(stock.ingredient.name, i18n.language);
  const unit = t(`inventory.units.${stock.ingredient.unit}`);

  const save = useMutation({
    mutationFn: () =>
      recordMovement({
        branchId: stock.branchId,
        ingredientId: stock.ingredient.id,
        kind,
        quantity: quantity.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
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
    const result = createMovementRequestSchema.safeParse({
      branchId: stock.branchId,
      ingredientId: stock.ingredient.id,
      kind,
      quantity,
      note,
    });
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    save.mutate();
  }
  const error = (field: string) => (problems[field] ? messageFor(problems[field], t) : undefined);

  return (
    <Dialog title={`${t(`inventory.movements.kinds.${kind}`)}: ${name}`} onClose={onCancel}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <p className="text-sm text-slate-600">
          {t('inventory.stock.now', { quantity: stock.quantity, unit })}
        </p>
        <FormField
          id="movement-quantity"
          label={
            kind === 'adjustment'
              ? t('inventory.movements.counted', { unit })
              : t('inventory.movements.quantity', { unit })
          }
          error={error('quantity')}
        >
          <input
            id="movement-quantity"
            type="text"
            inputMode="decimal"
            dir="ltr"
            autoFocus
            value={quantity}
            onChange={(event) => setQuantity(normalizeNumberInput(event.target.value))}
            className={`${fieldClass} text-lg`}
          />
        </FormField>
        <FormField
          id="movement-note"
          label={
            kind === 'received'
              ? t('inventory.movements.noteOptional')
              : t('inventory.movements.note')
          }
          error={error('note')}
        >
          <input
            id="movement-note"
            type="text"
            dir="auto"
            maxLength={200}
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
          <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// The stock of a branch: every active ingredient with its quantity, low level and value, the low
// ones first; and the buttons to receive, correct and record waste.
export function StockPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { branches, canMoveStock } = useInventoryContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('branchId');
  const branchId =
    branches.find((branch) => branch.id === requested)?.id ?? branches[0]?.id ?? null;
  const [moving, setMoving] = useState<{ stock: BranchStock; kind: ManualKind } | null>(null);
  const [onlyLow, setOnlyLow] = useState(false);

  const stock = useQuery({
    queryKey: inventoryKeys.stock(branchId ?? ''),
    queryFn: () => listStock(branchId ?? ''),
    enabled: Boolean(branchId),
  });
  const level = useMutation({
    mutationFn: ({ row, lowLevel }: { row: BranchStock; lowLevel: string | null }) =>
      setLowLevel(row.branchId, row.ingredient.id, lowLevel),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
  });

  const rows = (stock.data ?? []).filter((row) => !onlyLow || row.isLow);
  const total = rows.reduce((sum, row) => sum + Number(row.value), 0);
  const kinds: MovementKind[] = ['received', 'adjustment', 'waste'];

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('inventory.stock.intro')}</p>
      <div className="flex flex-wrap items-end gap-3">
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
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={onlyLow}
            onChange={(event) => setOnlyLow(event.target.checked)}
          />
          {t('inventory.stock.onlyLow')}
        </label>
      </div>

      {branches.length === 0 && (
        <p className="text-sm text-slate-500">{t('inventory.stock.noBranches')}</p>
      )}
      {stock.isPending && branchId && (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      )}
      {stock.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {stock.data && rows.length === 0 && (
        <p className="text-sm text-slate-500">{t('inventory.stock.empty')}</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="py-2 pe-3 text-start font-medium">
                  {t('inventory.stock.ingredient')}
                </th>
                <th className="py-2 pe-3 text-end font-medium">{t('inventory.stock.quantity')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('inventory.stock.lowLevel')}</th>
                <th className="py-2 pe-3 text-end font-medium">{t('inventory.stock.value')}</th>
                <th className="py-2 text-end font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const name = localize(row.ingredient.name, i18n.language);
                return (
                  <tr key={row.ingredient.id} className="border-b border-slate-100">
                    <td className="py-2 pe-3">
                      <span className="font-medium">{name}</span>
                      {row.isLow && (
                        <span className="ms-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                          {t('inventory.stock.low')}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pe-3 text-end whitespace-nowrap">
                      <bdi dir="ltr">{row.quantity}</bdi>{' '}
                      {t(`inventory.units.${row.ingredient.unit}`)}
                    </td>
                    <td className="py-2 pe-3 text-end whitespace-nowrap">
                      <bdi dir="ltr">{row.lowLevel ?? row.ingredient.lowLevel}</bdi>
                      {canMoveStock && (
                        <button
                          type="button"
                          onClick={() => {
                            const typed = window.prompt(
                              t('inventory.stock.levelPrompt', { name }),
                              row.lowLevel ?? '',
                            );
                            if (typed === null) return;
                            level.mutate({
                              row,
                              lowLevel:
                                typed.trim() === '' ? null : normalizeNumberInput(typed.trim()),
                            });
                          }}
                          className="ms-2 text-xs text-slate-600 underline"
                          aria-label={`${t('inventory.stock.setLevel')}: ${name}`}
                        >
                          {t('inventory.stock.setLevel')}
                        </button>
                      )}
                    </td>
                    <td className="py-2 pe-3 text-end whitespace-nowrap">
                      <Price value={row.value} />
                    </td>
                    <td className="py-2 text-end whitespace-nowrap">
                      {canMoveStock &&
                        kinds.map((kind) => (
                          <button
                            key={kind}
                            type="button"
                            onClick={() => setMoving({ stock: row, kind: kind as ManualKind })}
                            className="ms-1 rounded-md px-2 py-1 font-medium text-slate-700 hover:bg-slate-100"
                            aria-label={`${t(`inventory.movements.kinds.${kind}`)}: ${name}`}
                          >
                            {t(`inventory.movements.kinds.${kind}`)}
                          </button>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="py-2 pe-3 text-end font-medium">
                  {t('inventory.stock.total')}
                </td>
                <td className="py-2 pe-3 text-end font-semibold whitespace-nowrap">
                  <Price value={total.toFixed(3)} />
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {moving && (
        <MovementDialog
          stock={moving.stock}
          kind={moving.kind}
          onDone={() => setMoving(null)}
          onCancel={() => setMoving(null)}
        />
      )}
    </div>
  );
}
