import { quantitySchema, type StockCount, toMils, fromMils } from '@pos/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { Dialog } from '../../components/Dialog';
import {
  compactFieldClass,
  fieldClass,
  FormField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { Price, PriceInput } from '../../components/Price';
import { formatDateTime } from '../../i18n/format';
import { localize } from '../../i18n/localize';
import { messageFor, problemsFrom } from '../../lib/error-messages';
import { CountStatusBadge } from './CountsPage';
import {
  cancelCount,
  countKeys,
  finishCount,
  getCount,
  inventoryKeys,
  saveCountLines,
} from './inventory-api';
import { useInventoryContext } from './InventoryLayout';

// What was typed in each box, by ingredient.
type Typed = Record<string, string>;

const typedOf = (count: StockCount): Typed =>
  Object.fromEntries(count.lines.map((line) => [line.ingredient.id, line.counted ?? '']));

const signed = (text: string) => (text.startsWith('-') || Number(text) === 0 ? text : `+${text}`);

// One count: the boxes to type what is on the shelves, then the result once finished.
// See docs/specs/015-stock-counts.md.
export function CountPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const [searchParams] = useSearchParams();
  const count = useQuery({ queryKey: countKeys.one(id), queryFn: () => getCount(id) });
  const branchId = searchParams.get('branchId');
  // Up one level of the address: from counts/:id to counts.
  const back = { pathname: '..', search: branchId ? `?branchId=${branchId}` : '' };

  return (
    <div className="space-y-4">
      <Link to={back} relative="path" className="text-sm text-slate-600 underline">
        {t('inventory.counts.back')}
      </Link>
      {count.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {count.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {count.data && <CountSheet key={count.data.id} count={count.data} />}
    </div>
  );
}

function CountSheet({ count }: { count: StockCount }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { canMoveStock } = useInventoryContext();
  const [typed, setTyped] = useState<Typed>(() => typedOf(count));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const editable = canMoveStock && count.status === 'open';
  const saved = typedOf(count);
  const changed = Object.keys(typed).filter((key) => (typed[key] ?? '') !== (saved[key] ?? ''));

  const keep = (result: StockCount) => {
    queryClient.setQueryData(countKeys.one(count.id), result);
    void queryClient.invalidateQueries({ queryKey: countKeys.list(count.branchId) });
  };
  const fail = (error: unknown) => {
    const found = problemsFrom(error);
    setProblem(found.form ?? Object.values(found.fields)[0] ?? null);
  };

  // Checks the boxes that changed and sends them; null clears a box (rule 3).
  function changedLines() {
    const problems: Record<string, string> = {};
    const lines = changed.map((ingredientId) => {
      const text = (typed[ingredientId] ?? '').trim();
      if (text === '') return { ingredientId, counted: null };
      const parsed = quantitySchema.safeParse(text);
      if (!parsed.success) problems[ingredientId] = 'QUANTITY_INVALID';
      return { ingredientId, counted: parsed.success ? parsed.data : text };
    });
    setErrors(problems);
    return Object.keys(problems).length > 0 ? null : lines;
  }

  const save = useMutation({
    mutationFn: (lines: { ingredientId: string; counted: string | null }[]) =>
      saveCountLines(count.id, lines),
    onSuccess: (result) => {
      keep(result);
      setTyped(typedOf(result));
      setNotice(t('inventory.counts.messages.saved'));
    },
    onError: fail,
  });
  const finish = useMutation({
    mutationFn: async () => {
      const lines = changedLines();
      if (lines === null) throw new Error('invalid');
      if (lines.length > 0) await saveCountLines(count.id, lines);
      return finishCount(count.id);
    },
    onSuccess: async (result) => {
      keep(result);
      setTyped(typedOf(result));
      setConfirming(false);
      setNotice(t('inventory.counts.messages.finished'));
      await queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
    onError: (error) => {
      setConfirming(false);
      if (error instanceof Error && error.message === 'invalid') return;
      fail(error);
    },
  });
  const cancel = useMutation({
    mutationFn: () => cancelCount(count.id, reason.trim()),
    onSuccess: (result) => {
      keep(result);
      setCancelling(false);
      setNotice(t('inventory.counts.messages.cancelled'));
    },
    onError: (error) => {
      setCancelling(false);
      fail(error);
    },
  });

  // The difference as it is typed: counted minus expected, and its value (rule 5).
  const live = count.lines.map((line) => {
    const text = (typed[line.ingredient.id] ?? '').trim();
    const parsed = text === '' ? null : quantitySchema.safeParse(text);
    if (!editable) return { line, difference: line.difference, value: line.value };
    if (!parsed?.success) return { line, difference: null, value: null };
    const difference = toMils(parsed.data) - toMils(line.expected);
    const value = Math.round((difference * toMils(line.ingredient.costPerUnit)) / 1000);
    return { line, difference: fromMils(difference), value: fromMils(value) };
  });
  const countedNow = live.filter((row) => row.difference !== null).length;
  const lost = live.reduce((sum, row) => sum + Math.min(0, row.value ? toMils(row.value) : 0), 0);
  const found = live.reduce((sum, row) => sum + Math.max(0, row.value ? toMils(row.value) : 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">
          {t('inventory.counts.title', { number: count.number })}
        </h2>
        <CountStatusBadge status={count.status} />
      </div>
      <ul className="space-y-1 text-sm text-slate-600">
        <li>
          {t('inventory.counts.startedBy', {
            name: count.startedByName ?? '–',
            when: formatDateTime(count.startedAt, i18n.language),
          })}
        </li>
        {count.finishedAt && (
          <li>
            {t('inventory.counts.finishedBy', {
              name: count.finishedByName ?? '–',
              when: formatDateTime(count.finishedAt, i18n.language),
            })}
          </li>
        )}
        {count.cancelledAt && (
          <li>
            {t('inventory.counts.cancelledBy', {
              name: count.cancelledByName ?? '–',
              when: formatDateTime(count.cancelledAt, i18n.language),
              reason: count.cancelReason ?? '',
            })}
          </li>
        )}
        {count.note && <li>{count.note}</li>}
      </ul>
      {editable && <p className="text-sm text-slate-600">{t('inventory.counts.howTo')}</p>}

      {notice && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      {problem && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(problem, t)}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-600">
              <th className="py-2 pe-3 text-start font-medium">
                {t('inventory.stock.ingredient')}
              </th>
              <th className="py-2 pe-3 text-end font-medium">{t('inventory.counts.expected')}</th>
              <th className="py-2 pe-3 text-start font-medium">
                {t('inventory.counts.countedQuantity')}
              </th>
              <th className="py-2 pe-3 text-end font-medium">{t('inventory.counts.difference')}</th>
              <th className="py-2 text-end font-medium">{t('inventory.counts.value')}</th>
            </tr>
          </thead>
          <tbody>
            {live.map(({ line, difference, value }) => {
              const ingredientId = line.ingredient.id;
              const name = localize(line.ingredient.name, i18n.language);
              const unit = t(`inventory.units.${line.ingredient.unit}`);
              const inputId = `count-${ingredientId}`;
              const error = errors[ingredientId];
              const tone = difference?.startsWith('-')
                ? 'text-red-700'
                : difference && Number(difference) > 0
                  ? 'text-emerald-800'
                  : '';
              return (
                <tr key={ingredientId} className="border-b border-slate-100 align-top">
                  <td className="py-2 pe-3">
                    <label htmlFor={inputId} className="font-medium">
                      {name}
                    </label>
                  </td>
                  <td className="py-2 pe-3 text-end whitespace-nowrap">
                    <bdi dir="ltr">{line.expected}</bdi> {unit}
                  </td>
                  <td className="py-2 pe-3 whitespace-nowrap">
                    {editable ? (
                      <>
                        <PriceInput
                          id={inputId}
                          value={typed[ingredientId] ?? ''}
                          onChange={(next) => {
                            setNotice(null);
                            setTyped((current) => ({ ...current, [ingredientId]: next }));
                          }}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={error ? `${inputId}-error` : undefined}
                          className={`${compactFieldClass} w-28`}
                        />{' '}
                        {unit}
                        {error && (
                          <p id={`${inputId}-error`} className="mt-1 text-xs text-red-700">
                            {messageFor(error, t)}
                          </p>
                        )}
                      </>
                    ) : line.counted !== null ? (
                      <span>
                        <bdi dir="ltr">{line.counted}</bdi> {unit}
                      </span>
                    ) : (
                      <span className="text-slate-500">{t('inventory.counts.notCounted')}</span>
                    )}
                  </td>
                  <td className={`py-2 pe-3 text-end whitespace-nowrap ${tone}`}>
                    {difference !== null && <bdi dir="ltr">{signed(difference)}</bdi>}
                  </td>
                  <td className={`py-2 text-end whitespace-nowrap ${tone}`}>
                    {value !== null && <Price value={value} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td className="py-2 pe-3" colSpan={3}>
                {t('inventory.counts.ofLines', { counted: countedNow, total: count.lineCount })}
              </td>
              <td className="py-2 pe-3 text-end text-red-700">
                {t('inventory.counts.lost')}: <Price value={fromMils(lost)} />
              </td>
              <td className="py-2 text-end text-emerald-800">
                {t('inventory.counts.found')}: <Price value={fromMils(found)} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {editable && (
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setProblem(null);
              setCancelling(true);
            }}
            className={secondaryButtonClass}
          >
            {t('inventory.counts.cancel')}
          </button>
          <button
            type="button"
            disabled={save.isPending || changed.length === 0}
            onClick={() => {
              setProblem(null);
              const lines = changedLines();
              if (lines) save.mutate(lines);
            }}
            className={secondaryButtonClass}
          >
            {t('common.save')}
          </button>
          <button
            type="button"
            onClick={() => {
              setProblem(null);
              if (changedLines() === null) return;
              setConfirming(true);
            }}
            className={primaryButtonClass}
          >
            {t('inventory.counts.finish')}
          </button>
        </div>
      )}

      {confirming && (
        <Dialog
          title={t('inventory.counts.confirmTitle')}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className={secondaryButtonClass}
              >
                {t('common.back')}
              </button>
              <button
                type="button"
                disabled={finish.isPending}
                onClick={() => finish.mutate()}
                className={primaryButtonClass}
              >
                {t('inventory.counts.confirmFinish')}
              </button>
            </>
          }
        >
          <div className="space-y-2 text-sm">
            <p>{t('inventory.counts.confirmText')}</p>
            <p>{t('inventory.counts.ofLines', { counted: countedNow, total: count.lineCount })}</p>
            <p className="text-red-700">
              {t('inventory.counts.lost')}: <Price value={fromMils(lost)} />
            </p>
            <p className="text-emerald-800">
              {t('inventory.counts.found')}: <Price value={fromMils(found)} />
            </p>
          </div>
        </Dialog>
      )}

      {cancelling && (
        <Dialog
          title={t('inventory.counts.cancel')}
          onClose={() => setCancelling(false)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setCancelling(false)}
                className={secondaryButtonClass}
              >
                {t('common.back')}
              </button>
              <button
                type="button"
                disabled={cancel.isPending}
                onClick={() => {
                  if (!reason.trim()) {
                    setErrors((current) => ({ ...current, reason: 'NOTE_REQUIRED' }));
                    return;
                  }
                  cancel.mutate();
                }}
                className={primaryButtonClass}
              >
                {t('inventory.counts.confirmCancel')}
              </button>
            </>
          }
        >
          <FormField
            id="count-cancel-reason"
            label={t('inventory.counts.cancelReason')}
            error={errors.reason ? messageFor(errors.reason, t) : undefined}
          >
            <input
              id="count-cancel-reason"
              type="text"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={fieldClass}
            />
          </FormField>
        </Dialog>
      )}
    </div>
  );
}
