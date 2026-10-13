import {
  type BranchStock,
  createTransferRequestSchema,
  MAX_TRANSFER_LINES,
  type StockTransfer,
} from '@pos/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { Dialog } from '../../components/Dialog';
import {
  compactFieldClass,
  fieldAttributes,
  fieldClass,
  FormField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { PriceInput } from '../../components/Price';
import { formatDateTime } from '../../i18n/format';
import { localize } from '../../i18n/localize';
import { fieldsFromIssues, messageFor, problemsFrom } from '../../lib/error-messages';
import { useAuth } from '../auth/auth-context';
import {
  cancelTransfer,
  getTransfer,
  inventoryKeys,
  listDestinations,
  listStock,
  listTransfers,
  receiveTransfer,
  sendTransfer,
  transferKeys,
} from './inventory-api';
import { useInventoryContext } from './InventoryLayout';

const statusClass: Record<StockTransfer['status'], string> = {
  sent: 'bg-amber-100 text-amber-900',
  received: 'bg-emerald-100 text-emerald-900',
  cancelled: 'bg-slate-200 text-slate-700',
};

function StatusBadge({ status }: { status: StockTransfer['status'] }) {
  const { t } = useTranslation();
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass[status]}`}>
      {t(`inventory.transfers.statuses.${status}`)}
    </span>
  );
}

interface Line {
  ingredientId: string;
  quantity: string;
}

interface NewTransferDialogProps {
  fromBranchId: string;
  onDone: () => void;
  onCancel: () => void;
}

// Sends stock from the chosen branch to another branch of the brand (spec 014, rules 1 and 2).
function NewTransferDialog({ fromBranchId, onDone, onCancel }: NewTransferDialogProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [toBranchId, setToBranchId] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [adding, setAdding] = useState('');
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);

  const destinations = useQuery({
    queryKey: transferKeys.destinations(fromBranchId),
    queryFn: () => listDestinations(fromBranchId),
  });
  const stock = useQuery({
    queryKey: inventoryKeys.stock(fromBranchId),
    queryFn: () => listStock(fromBranchId),
  });
  const stockOf = new Map((stock.data ?? []).map((row) => [row.ingredient.id, row]));
  const used = new Set(lines.map((line) => line.ingredientId));
  const free = (stock.data ?? []).filter((row) => !used.has(row.ingredient.id));
  const nameOf = (row: BranchStock | undefined) =>
    row ? localize(row.ingredient.name, i18n.language) : '';
  const unitOf = (row: BranchStock | undefined) =>
    row ? t(`inventory.units.${row.ingredient.unit}`) : '';

  const send = useMutation({
    mutationFn: (body: Parameters<typeof sendTransfer>[0]) => sendTransfer(body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      onDone();
    },
    onError: (error) => {
      const found = problemsFrom(error);
      setProblems(found.fields);
      setFormProblem(found.form ?? found.fields.lines ?? null);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormProblem(null);
    const body = { fromBranchId, toBranchId, note, lines };
    const result = createTransferRequestSchema.safeParse(body);
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    setProblems(found);
    if (!result.success) {
      setFormProblem(found.lines ?? null);
      return;
    }
    send.mutate(body);
  }
  const error = (field: string) => (problems[field] ? messageFor(problems[field], t) : undefined);

  return (
    <Dialog title={t('inventory.transfers.new')} onClose={onCancel}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormField
          id="transfer-to"
          label={t('inventory.transfers.toBranch')}
          error={error('toBranchId')}
        >
          <select
            {...fieldAttributes('transfer-to', { error: Boolean(error('toBranchId')) })}
            value={toBranchId}
            onChange={(event) => setToBranchId(event.target.value)}
            className={fieldClass}
            disabled={destinations.data?.length === 0}
          >
            <option value="">
              {destinations.data?.length === 0
                ? t('inventory.transfers.noDestinations')
                : t('inventory.transfers.chooseBranch')}
            </option>
            {destinations.data?.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {localize(branch.name, i18n.language)}
              </option>
            ))}
          </select>
        </FormField>

        {lines.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="py-2 pe-3 text-start font-medium">
                  {t('inventory.transfers.ingredient')}
                </th>
                <th className="py-2 pe-3 text-start font-medium">
                  {t('inventory.transfers.quantity')}
                </th>
                <th className="py-2 text-end font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const row = stockOf.get(line.ingredientId);
                const name = nameOf(row);
                const id = `transfer-${index}-quantity`;
                const lineError = error(`lines.${index}.quantity`);
                return (
                  <tr key={line.ingredientId} className="border-b border-slate-100 align-top">
                    <td className="py-2 pe-3">
                      <label htmlFor={id} className="font-medium">
                        {name}
                      </label>
                      {row && (
                        <span className="block text-xs text-slate-500">
                          {t('inventory.transfers.inStock', {
                            quantity: row.quantity,
                            unit: unitOf(row),
                          })}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pe-3 whitespace-nowrap">
                      <PriceInput
                        id={id}
                        value={line.quantity}
                        onChange={(value) =>
                          setLines((current) =>
                            current.map((entry, at) =>
                              at === index ? { ...entry, quantity: value } : entry,
                            ),
                          )
                        }
                        aria-invalid={lineError ? true : undefined}
                        aria-describedby={lineError ? `${id}-error` : undefined}
                        className={`${compactFieldClass} w-28`}
                      />{' '}
                      {unitOf(row)}
                      {lineError && (
                        <p id={`${id}-error`} className="mt-1 text-xs text-red-700">
                          {lineError}
                        </p>
                      )}
                    </td>
                    <td className="py-2 text-end">
                      <button
                        type="button"
                        onClick={() =>
                          setLines((current) => current.filter((_, at) => at !== index))
                        }
                        aria-label={t('inventory.transfers.removeFor', { name })}
                        className="text-xs text-slate-600 underline"
                      >
                        {t('inventory.transfers.remove')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm font-medium text-slate-700">
            {t('inventory.transfers.add')}
            <select
              value={adding}
              onChange={(event) => setAdding(event.target.value)}
              disabled={free.length === 0 || lines.length >= MAX_TRANSFER_LINES}
              className={`${compactFieldClass} mt-1 block`}
            >
              <option value="">{t('inventory.transfers.choose')}</option>
              {free.map((row) => (
                <option key={row.ingredient.id} value={row.ingredient.id}>
                  {nameOf(row)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!adding}
            onClick={() => {
              setLines((current) => [...current, { ingredientId: adding, quantity: '' }]);
              setAdding('');
            }}
            className={secondaryButtonClass}
          >
            {t('inventory.transfers.addButton')}
          </button>
        </div>

        <FormField id="transfer-note" label={t('inventory.transfers.note')} error={error('note')}>
          <input
            id="transfer-note"
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
          <button type="submit" disabled={send.isPending} className={primaryButtonClass}>
            {t('inventory.transfers.send')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

interface TransferDialogProps {
  id: string;
  // Whether the person may change stock at a branch (spec 014, rule 6).
  actsAt: (branchId: string) => boolean;
  onClose: () => void;
}

// One transfer with its lines, and the receive and cancel buttons for the right branch.
function TransferDialog({ id, actsAt, onClose }: TransferDialogProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const transfer = useQuery({ queryKey: transferKeys.one(id), queryFn: () => getTransfer(id) });
  const done = async (saved: StockTransfer, message: string) => {
    queryClient.setQueryData(transferKeys.one(id), saved);
    await queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    setCancelling(false);
    setNotice(message);
  };
  const fail = (error: unknown) => {
    const found = problemsFrom(error);
    setProblem(found.form ?? found.fields.reason ?? null);
  };
  const receive = useMutation({
    mutationFn: () => receiveTransfer(id),
    onSuccess: (saved) => done(saved, t('inventory.transfers.messages.received')),
    onError: fail,
  });
  const cancel = useMutation({
    mutationFn: () => cancelTransfer(id, reason.trim()),
    onSuccess: (saved) => done(saved, t('inventory.transfers.messages.cancelled')),
    onError: fail,
  });

  const row = transfer.data;
  const title = row
    ? t('inventory.transfers.title', { number: row.number })
    : t('inventory.transfers.titleLoading');
  const when = (iso: string | null) => (iso ? formatDateTime(iso, i18n.language) : '');

  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose} className={secondaryButtonClass}>
          {t('inventory.transfers.close')}
        </button>
      }
    >
      {transfer.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {transfer.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {row && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={row.status} />
            <span>
              {t('inventory.transfers.route', {
                from: localize(row.fromBranch.name, i18n.language),
                to: localize(row.toBranch.name, i18n.language),
              })}
            </span>
          </div>
          {row.note && <p className="text-slate-600">{row.note}</p>}

          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="py-2 pe-3 text-start font-medium">
                  {t('inventory.transfers.ingredient')}
                </th>
                <th className="py-2 text-end font-medium">{t('inventory.transfers.quantity')}</th>
              </tr>
            </thead>
            <tbody>
              {row.lines.map((line) => (
                <tr key={line.ingredient.id} className="border-b border-slate-100">
                  <td className="py-2 pe-3">{localize(line.ingredient.name, i18n.language)}</td>
                  <td className="py-2 text-end whitespace-nowrap">
                    <bdi dir="ltr">{line.quantity}</bdi>{' '}
                    {t(`inventory.units.${line.ingredient.unit}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="space-y-1 text-xs text-slate-600">
            <li>
              {t('inventory.transfers.sentBy', {
                name: row.sentByName ?? '–',
                when: when(row.sentAt),
              })}
            </li>
            {row.receivedAt && (
              <li>
                {t('inventory.transfers.receivedBy', {
                  name: row.receivedByName ?? '–',
                  when: when(row.receivedAt),
                })}
              </li>
            )}
            {row.cancelledAt && (
              <li>
                {t('inventory.transfers.cancelledBy', {
                  name: row.cancelledByName ?? '–',
                  when: when(row.cancelledAt),
                  reason: row.cancelReason ?? '',
                })}
              </li>
            )}
          </ul>

          {notice && (
            <p role="status" className="rounded-md bg-emerald-50 p-3 text-emerald-800">
              {notice}
            </p>
          )}
          {problem && problem !== 'NOTE_REQUIRED' && (
            <p role="alert" className="rounded-md bg-red-50 p-3 text-red-700">
              {messageFor(problem, t)}
            </p>
          )}

          {row.status === 'sent' && (
            <div className="flex flex-wrap items-end justify-end gap-2">
              {actsAt(row.fromBranch.id) && !cancelling && (
                <button
                  type="button"
                  onClick={() => {
                    setProblem(null);
                    setCancelling(true);
                  }}
                  className={secondaryButtonClass}
                >
                  {t('inventory.transfers.cancel')}
                </button>
              )}
              {actsAt(row.toBranch.id) && !cancelling && (
                <button
                  type="button"
                  disabled={receive.isPending}
                  onClick={() => {
                    setProblem(null);
                    receive.mutate();
                  }}
                  className={primaryButtonClass}
                >
                  {t('inventory.transfers.receive')}
                </button>
              )}
              {cancelling && (
                <div className="w-full space-y-2">
                  <FormField
                    id="transfer-cancel-reason"
                    label={t('inventory.transfers.cancelReason')}
                    error={problem === 'NOTE_REQUIRED' ? messageFor(problem, t) : undefined}
                  >
                    <input
                      id="transfer-cancel-reason"
                      type="text"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      className={fieldClass}
                    />
                  </FormField>
                  <div className="flex justify-end gap-2">
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
                          setProblem('NOTE_REQUIRED');
                          return;
                        }
                        setProblem(null);
                        cancel.mutate();
                      }}
                      className={primaryButtonClass}
                    >
                      {t('inventory.transfers.confirmCancel')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

// The transfers in and out of a branch, newest first, and the way to send a new one.
// See docs/specs/014-stock-transfers.md.
export function TransfersPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { branches, canMoveStock } = useInventoryContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const branchId =
    branches.find((branch) => branch.id === searchParams.get('branchId'))?.id ??
    branches[0]?.id ??
    null;
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const transfers = useQuery({
    queryKey: transferKeys.list(branchId ?? ''),
    queryFn: () => listTransfers(branchId ?? ''),
    enabled: Boolean(branchId),
  });
  // A branch-scoped person changes stock at their own branches only (rule 6).
  const actsAt = (id: string) =>
    canMoveStock && (user?.scope !== 'BRANCH' || (user?.branchIds.includes(id) ?? false));

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('inventory.transfers.intro')}</p>
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
        {branchId && actsAt(branchId) && (
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setCreating(true);
            }}
            className={primaryButtonClass}
          >
            {t('inventory.transfers.new')}
          </button>
        )}
      </div>

      {notice && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      {transfers.isPending && branchId && (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      )}
      {transfers.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {transfers.data?.length === 0 && (
        <p className="text-sm text-slate-500">{t('inventory.transfers.empty')}</p>
      )}

      {transfers.data && transfers.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="py-2 pe-3 text-start font-medium">
                  {t('inventory.transfers.number')}
                </th>
                <th className="py-2 pe-3 text-start font-medium">
                  {t('inventory.transfers.direction')}
                </th>
                <th className="py-2 pe-3 text-start font-medium">
                  {t('inventory.transfers.status')}
                </th>
                <th className="py-2 pe-3 text-end font-medium">{t('inventory.transfers.lines')}</th>
                <th className="py-2 pe-3 text-start font-medium">
                  {t('inventory.transfers.sent')}
                </th>
                <th className="py-2 text-end font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {transfers.data.map((row) => {
                const outgoing = row.fromBranch.id === branchId;
                const other = localize(
                  outgoing ? row.toBranch.name : row.fromBranch.name,
                  i18n.language,
                );
                return (
                  <tr key={row.id} className="border-b border-slate-100">
                    <td className="py-2 pe-3 font-medium">#{row.number}</td>
                    <td className="py-2 pe-3">
                      {outgoing
                        ? t('inventory.transfers.out', { branch: other })
                        : t('inventory.transfers.in', { branch: other })}
                    </td>
                    <td className="py-2 pe-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="py-2 pe-3 text-end">{row.lines.length}</td>
                    <td className="py-2 pe-3 whitespace-nowrap">
                      {formatDateTime(row.sentAt, i18n.language)}
                      <span className="block text-xs text-slate-500">{row.sentByName ?? '–'}</span>
                    </td>
                    <td className="py-2 text-end">
                      <button
                        type="button"
                        onClick={() => {
                          setNotice(null);
                          setOpenId(row.id);
                        }}
                        aria-label={t('inventory.transfers.openFor', { number: row.number })}
                        className="text-xs text-slate-600 underline"
                      >
                        {t('inventory.transfers.open')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating && branchId && (
        <NewTransferDialog
          fromBranchId={branchId}
          onDone={() => {
            setCreating(false);
            setNotice(t('inventory.transfers.messages.sent'));
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      {openId && <TransferDialog id={openId} actsAt={actsAt} onClose={() => setOpenId(null)} />}
    </div>
  );
}
