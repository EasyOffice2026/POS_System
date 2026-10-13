import {
  fromMils,
  MAX_PURCHASE_ORDER_LINES,
  type PurchaseOrder,
  toMils,
  updatePurchaseOrderRequestSchema,
} from '@pos/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { Dialog } from '../../components/Dialog';
import {
  compactFieldClass,
  fieldClass,
  FormField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { Price, PriceInput } from '../../components/Price';
import { formatDate, formatDateTime } from '../../i18n/format';
import { localize } from '../../i18n/localize';
import { fieldsFromIssues, messageFor, problemsFrom } from '../../lib/error-messages';
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  getSupplier,
  inventoryKeys,
  listIngredients,
  listSuppliers,
  purchaseOrderKeys,
  sendPurchaseOrder,
  supplierKeys,
  updatePurchaseOrder,
} from './inventory-api';
import { useInventoryContext } from './InventoryLayout';
import { OrderStatusBadge } from './PurchaseOrdersPage';

interface Line {
  ingredientId: string;
  quantity: string;
  unitPrice: string;
}

const decimal = /^\d{1,12}(\.\d{1,3})?$/;
const lineTotalOf = (line: Line) =>
  decimal.test(line.quantity.trim()) && decimal.test(line.unitPrice.trim())
    ? Math.round((toMils(line.quantity.trim()) * toMils(line.unitPrice.trim())) / 1000)
    : 0;

// One purchase order, or a new one (the address ends in /new). See docs/specs/018-purchase-orders.md.
export function PurchaseOrderPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const { search } = useLocation();
  const isNew = id === 'new';
  const order = useQuery({
    queryKey: purchaseOrderKeys.one(id),
    queryFn: () => getPurchaseOrder(id),
    enabled: !isNew,
  });

  return (
    <div className="space-y-4">
      <Link
        to={{ pathname: '..', search }}
        relative="path"
        className="text-sm text-slate-600 underline"
      >
        {t('inventory.purchaseOrders.back')}
      </Link>
      {isNew && <NewOrder />}
      {!isNew && order.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {!isNew && order.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {order.data && <OrderSheet key={order.data.id} order={order.data} />}
    </div>
  );
}

// A new order first asks for the supplier, then for the lines.
function NewOrder() {
  const { t, i18n } = useTranslation();
  const { brandId, branches } = useInventoryContext();
  const [searchParams] = useSearchParams();
  const branch = branches.find((row) => row.id === searchParams.get('branchId')) ?? branches[0];
  const [supplierId, setSupplierId] = useState('');
  const suppliers = useQuery({
    queryKey: supplierKeys.list(brandId),
    queryFn: () => listSuppliers(brandId),
  });
  const active = (suppliers.data ?? []).filter((supplier) => supplier.isActive);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{t('inventory.purchaseOrders.new')}</h2>
      {branch && (
        <p className="text-sm text-slate-600">
          {t('inventory.purchaseOrders.forBranch', {
            branch: localize(branch.name, i18n.language),
          })}
        </p>
      )}
      <label className="block max-w-sm text-sm font-medium text-slate-700">
        {t('inventory.purchaseOrders.supplier')}
        <select
          value={supplierId}
          onChange={(event) => setSupplierId(event.target.value)}
          className={fieldClass}
        >
          <option value="">
            {suppliers.data && active.length === 0
              ? t('inventory.purchaseOrders.noSuppliers')
              : t('inventory.purchaseOrders.chooseSupplier')}
          </option>
          {active.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </label>
      {branch && supplierId && (
        <OrderEditor key={supplierId} branchId={branch.id} supplierId={supplierId} order={null} />
      )}
    </div>
  );
}

interface OrderEditorProps {
  branchId: string;
  supplierId: string;
  // The draft being changed, or null for a new one.
  order: PurchaseOrder | null;
  // Says what happened above the order, which stays when a sent order turns read only.
  onNotice?: (notice: string | null) => void;
}

// The lines, expected date and note of a draft (rules 2 to 4).
function OrderEditor({ branchId, supplierId, order, onNotice }: OrderEditorProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { search } = useLocation();
  const { brandId } = useInventoryContext();
  const [lines, setLines] = useState<Line[]>(() =>
    (order?.lines ?? []).map((line) => ({
      ingredientId: line.ingredient.id,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    })),
  );
  const [expectedOn, setExpectedOn] = useState(order?.expectedOn ?? '');
  const [note, setNote] = useState(order?.note ?? '');
  const [adding, setAdding] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const setNotice = (notice: string | null) => onNotice?.(notice);
  const [cancelling, setCancelling] = useState(false);

  const ingredients = useQuery({
    queryKey: inventoryKeys.ingredients(order?.brandId ?? brandId),
    queryFn: () => listIngredients(order?.brandId ?? brandId),
  });
  const supplier = useQuery({
    queryKey: supplierKeys.one(supplierId),
    queryFn: () => getSupplier(supplierId),
  });
  const listed = new Map(
    (supplier.data?.prices ?? []).map((line) => [line.ingredient.id, line.price]),
  );
  const ingredientOf = new Map((ingredients.data ?? []).map((row) => [row.id, row]));
  for (const line of order?.lines ?? []) ingredientOf.set(line.ingredient.id, line.ingredient);
  const used = new Set(lines.map((line) => line.ingredientId));
  // What the supplier sells first, then the rest of the active ingredients.
  const free = (ingredients.data ?? [])
    .filter((row) => row.isActive && !used.has(row.id))
    .sort((a, b) => Number(listed.has(b.id)) - Number(listed.has(a.id)));
  const total = lines.reduce((sum, line) => sum + lineTotalOf(line), 0);

  const body = () => ({
    expectedOn: expectedOn || null,
    note,
    lines: lines.map((line) => ({
      ingredientId: line.ingredientId,
      quantity: line.quantity.trim(),
      unitPrice: line.unitPrice.trim() === '' ? null : line.unitPrice.trim(),
    })),
  });

  function check() {
    setProblem(null);
    setNotice(null);
    const parsed = updatePurchaseOrderRequestSchema.safeParse(body());
    const found = parsed.success ? {} : fieldsFromIssues(parsed.error.issues);
    setErrors(found);
    if (!parsed.success) setProblem(found.lines ?? null);
    return parsed.success;
  }

  const fail = (error: unknown) => {
    const found = problemsFrom(error);
    setErrors(found.fields);
    setProblem(
      found.form ??
        Object.entries(found.fields).find(([path]) => !/^lines\.\d+\./.test(path))?.[1] ??
        null,
    );
  };

  const save = useMutation({
    mutationFn: async (then: 'stay' | 'send') => {
      const saved = order
        ? await updatePurchaseOrder(order.id, body())
        : await createPurchaseOrder({ branchId, supplierId, ...body() });
      return then === 'send' ? sendPurchaseOrder(saved.id) : saved;
    },
    onSuccess: async (saved, then) => {
      queryClient.setQueryData(purchaseOrderKeys.one(saved.id), saved);
      await queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.list(saved.branchId) });
      if (!order) {
        void navigate({ pathname: `../${saved.id}`, search }, { relative: 'path' });
        return;
      }
      setNotice(
        then === 'send'
          ? t('inventory.purchaseOrders.messages.sent')
          : t('inventory.purchaseOrders.messages.saved'),
      );
    },
    onError: fail,
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (check()) save.mutate('stay');
  }

  return (
    <>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {problem && (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {messageFor(problem, t)}
          </p>
        )}

        {lines.length === 0 ? (
          <p className="text-sm text-slate-500">{t('inventory.purchaseOrders.noLines')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-2 pe-3 text-start font-medium">
                    {t('inventory.stock.ingredient')}
                  </th>
                  <th className="py-2 pe-3 text-start font-medium">
                    {t('inventory.purchaseOrders.quantity')}
                  </th>
                  <th className="py-2 pe-3 text-start font-medium">
                    {t('inventory.purchaseOrders.unitPrice')}
                  </th>
                  <th className="py-2 pe-3 text-end font-medium">
                    {t('inventory.purchaseOrders.lineTotal')}
                  </th>
                  <th className="py-2 text-end font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const ingredient = ingredientOf.get(line.ingredientId);
                  const name = ingredient ? localize(ingredient.name, i18n.language) : '';
                  const unit = ingredient ? t(`inventory.units.${ingredient.unit}`) : '';
                  const quantityId = `po-${line.ingredientId}-quantity`;
                  const priceId = `po-${line.ingredientId}-price`;
                  const quantityError = errors[`lines.${index}.quantity`];
                  const priceError = errors[`lines.${index}.unitPrice`];
                  const change = (patch: Partial<Line>) =>
                    setLines((current) =>
                      current.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)),
                    );
                  return (
                    <tr key={line.ingredientId} className="border-b border-slate-100 align-top">
                      <td className="py-2 pe-3">
                        <label htmlFor={quantityId} className="font-medium">
                          {name}
                        </label>
                      </td>
                      <td className="py-2 pe-3 whitespace-nowrap">
                        <PriceInput
                          id={quantityId}
                          value={line.quantity}
                          onChange={(quantity) => change({ quantity })}
                          aria-invalid={quantityError ? true : undefined}
                          aria-describedby={quantityError ? `${quantityId}-error` : undefined}
                          className={`${compactFieldClass} w-24`}
                        />{' '}
                        {unit}
                        {quantityError && (
                          <p id={`${quantityId}-error`} className="mt-1 text-xs text-red-700">
                            {messageFor(quantityError, t)}
                          </p>
                        )}
                      </td>
                      <td className="py-2 pe-3 whitespace-nowrap">
                        <PriceInput
                          id={priceId}
                          value={line.unitPrice}
                          onChange={(unitPrice) => change({ unitPrice })}
                          aria-label={t('inventory.purchaseOrders.priceFor', { name })}
                          aria-invalid={priceError ? true : undefined}
                          aria-describedby={priceError ? `${priceId}-error` : undefined}
                          className={`${compactFieldClass} w-24`}
                        />
                        {priceError && (
                          <p id={`${priceId}-error`} className="mt-1 text-xs text-red-700">
                            {messageFor(priceError, t)}
                          </p>
                        )}
                      </td>
                      <td className="py-2 pe-3 text-end whitespace-nowrap">
                        <Price value={fromMils(lineTotalOf(line))} />
                      </td>
                      <td className="py-2 text-end">
                        <button
                          type="button"
                          onClick={() =>
                            setLines((current) => current.filter((_, at) => at !== index))
                          }
                          aria-label={t('inventory.purchaseOrders.removeFor', { name })}
                          className="text-xs text-slate-600 underline"
                        >
                          {t('inventory.purchaseOrders.remove')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="py-2 pe-3" colSpan={3}>
                    {t('inventory.purchaseOrders.total')}
                  </td>
                  <td className="py-2 pe-3 text-end whitespace-nowrap">
                    <Price value={fromMils(total)} />
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm font-medium text-slate-700">
            {t('inventory.purchaseOrders.add')}
            <select
              value={adding}
              onChange={(event) => setAdding(event.target.value)}
              disabled={free.length === 0 || lines.length >= MAX_PURCHASE_ORDER_LINES}
              className={`${compactFieldClass} mt-1 block`}
            >
              <option value="">{t('inventory.purchaseOrders.chooseIngredient')}</option>
              {free.map((row) => (
                <option key={row.id} value={row.id}>
                  {localize(row.name, i18n.language)}
                  {listed.has(row.id) ? ` · ${listed.get(row.id) ?? ''}` : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!adding}
            onClick={() => {
              setLines((current) => [
                ...current,
                { ingredientId: adding, quantity: '', unitPrice: listed.get(adding) ?? '' },
              ]);
              setAdding('');
            }}
            className={secondaryButtonClass}
          >
            {t('inventory.purchaseOrders.addButton')}
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            id="po-expected"
            label={t('inventory.purchaseOrders.expectedOn')}
            error={errors.expectedOn ? messageFor(errors.expectedOn, t) : undefined}
          >
            <input
              id="po-expected"
              type="date"
              value={expectedOn}
              onChange={(event) => setExpectedOn(event.target.value)}
              className={fieldClass}
            />
          </FormField>
          <FormField
            id="po-note"
            label={t('inventory.purchaseOrders.note')}
            error={errors.note ? messageFor(errors.note, t) : undefined}
          >
            <input
              id="po-note"
              type="text"
              dir="auto"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className={fieldClass}
            />
          </FormField>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {order && (
            <button
              type="button"
              onClick={() => setCancelling(true)}
              className={secondaryButtonClass}
            >
              {t('inventory.purchaseOrders.cancel')}
            </button>
          )}
          <button type="submit" disabled={save.isPending} className={secondaryButtonClass}>
            {t('inventory.purchaseOrders.saveDraft')}
          </button>
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => {
              if (check()) save.mutate('send');
            }}
            className={primaryButtonClass}
          >
            {t('inventory.purchaseOrders.send')}
          </button>
        </div>
      </form>
      {/* Outside the form, so Enter in the reason does not save the draft. */}
      {cancelling && order && <CancelDialog order={order} onClose={() => setCancelling(false)} />}
    </>
  );
}

// Cancelling a draft or a sent order, with the reason (rule 6).
function CancelDialog({ order, onClose }: { order: PurchaseOrder; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: () => cancelPurchaseOrder(order.id, reason.trim()),
    onSuccess: async (saved) => {
      queryClient.setQueryData(purchaseOrderKeys.one(order.id), saved);
      await queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.list(order.branchId) });
      onClose();
    },
    onError: (error) => setProblem(problemsFrom(error).form ?? 'saveError'),
  });

  return (
    <Dialog
      title={t('inventory.purchaseOrders.cancel')}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
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
              cancel.mutate();
            }}
            className={primaryButtonClass}
          >
            {t('inventory.purchaseOrders.confirmCancel')}
          </button>
        </>
      }
    >
      <FormField
        id="po-cancel-reason"
        label={t('inventory.purchaseOrders.cancelReason')}
        error={problem ? messageFor(problem, t) : undefined}
      >
        <input
          id="po-cancel-reason"
          type="text"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={fieldClass}
        />
      </FormField>
    </Dialog>
  );
}

// An order: its header, then the editor for a draft or the lines for the rest.
function OrderSheet({ order }: { order: PurchaseOrder }) {
  const { t, i18n } = useTranslation();
  const { canMoveStock } = useInventoryContext();
  const [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const editable = canMoveStock && order.status === 'draft';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">
          {t('inventory.purchaseOrders.title', { number: order.number })}
        </h2>
        <OrderStatusBadge status={order.status} />
      </div>
      <ul className="space-y-1 text-sm text-slate-600">
        <li>
          {t('inventory.purchaseOrders.toSupplier', { supplier: order.supplier.name })}
          {order.supplier.phone && (
            <>
              {' · '}
              <bdi dir="ltr">{order.supplier.phone}</bdi>
            </>
          )}
        </li>
        <li>
          {t('inventory.purchaseOrders.forBranch', {
            branch: localize(order.branch.name, i18n.language),
          })}
        </li>
        <li>
          {t('inventory.purchaseOrders.createdBy', {
            name: order.createdByName ?? '–',
            when: formatDateTime(order.createdAt, i18n.language),
          })}
        </li>
        {order.sentAt && (
          <li>
            {t('inventory.purchaseOrders.sentBy', {
              name: order.sentByName ?? '–',
              when: formatDateTime(order.sentAt, i18n.language),
            })}
          </li>
        )}
        {order.cancelledAt && (
          <li>
            {t('inventory.purchaseOrders.cancelledBy', {
              name: order.cancelledByName ?? '–',
              when: formatDateTime(order.cancelledAt, i18n.language),
              reason: order.cancelReason ?? '',
            })}
          </li>
        )}
      </ul>
      {notice && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}

      {editable ? (
        <OrderEditor
          branchId={order.branchId}
          supplierId={order.supplier.id}
          order={order}
          onNotice={setNotice}
        />
      ) : (
        <>
          <OrderLines order={order} />
          {(order.expectedOn ?? order.note) && (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {order.expectedOn && (
                <div>
                  <dt className="text-xs text-slate-500">
                    {t('inventory.purchaseOrders.expectedOn')}
                  </dt>
                  <dd>{formatDate(order.expectedOn, i18n.language)}</dd>
                </div>
              )}
              {order.note && (
                <div>
                  <dt className="text-xs text-slate-500">
                    {t('inventory.purchaseOrders.noteHeading')}
                  </dt>
                  <dd>
                    <bdi>{order.note}</bdi>
                  </dd>
                </div>
              )}
            </dl>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {canMoveStock && order.status === 'sent' && (
              <button
                type="button"
                onClick={() => setCancelling(true)}
                className={secondaryButtonClass}
              >
                {t('inventory.purchaseOrders.cancel')}
              </button>
            )}
            {order.status !== 'draft' && order.status !== 'cancelled' && (
              <button type="button" onClick={() => window.print()} className={primaryButtonClass}>
                {t('inventory.purchaseOrders.print')}
              </button>
            )}
          </div>
          {cancelling && <CancelDialog order={order} onClose={() => setCancelling(false)} />}
          {createPortal(<PrintedOrder order={order} />, document.body)}
        </>
      )}
    </div>
  );
}

function OrderLines({ order }: { order: PurchaseOrder }) {
  const { t, i18n } = useTranslation();
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-300 text-slate-600">
          <th className="py-2 pe-3 text-start font-medium">{t('inventory.stock.ingredient')}</th>
          <th className="py-2 pe-3 text-end font-medium">
            {t('inventory.purchaseOrders.quantity')}
          </th>
          <th className="py-2 pe-3 text-end font-medium">
            {t('inventory.purchaseOrders.unitPrice')}
          </th>
          <th className="py-2 text-end font-medium">{t('inventory.purchaseOrders.lineTotal')}</th>
        </tr>
      </thead>
      <tbody>
        {order.lines.map((line) => (
          <tr key={line.ingredient.id} className="border-b border-slate-100">
            <td className="py-2 pe-3">{localize(line.ingredient.name, i18n.language)}</td>
            <td className="py-2 pe-3 text-end whitespace-nowrap">
              <bdi dir="ltr">{line.quantity}</bdi> {t(`inventory.units.${line.ingredient.unit}`)}
            </td>
            <td className="py-2 pe-3 text-end whitespace-nowrap">
              <Price value={line.unitPrice} />
            </td>
            <td className="py-2 text-end whitespace-nowrap">
              <Price value={line.lineTotal} />
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="font-semibold">
          <td className="py-2 pe-3" colSpan={3}>
            {t('inventory.purchaseOrders.total')}
          </td>
          <td className="py-2 text-end whitespace-nowrap">
            <Price value={order.total} />
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

// The order as a page to give or send to the supplier: only this shows when printing.
function PrintedOrder({ order }: { order: PurchaseOrder }) {
  const { t, i18n } = useTranslation();
  return (
    <div
      aria-hidden="true"
      className="hidden bg-white p-8 text-sm text-black print:block"
      data-testid="printed-order"
    >
      <h1 className="text-2xl font-bold">
        {t('inventory.purchaseOrders.title', { number: order.number })}
      </h1>
      <div className="my-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs uppercase text-slate-500">
            {t('inventory.purchaseOrders.supplier')}
          </p>
          <p className="font-semibold">
            <bdi>{order.supplier.name}</bdi>
          </p>
          {order.supplier.contactName && <p>{order.supplier.contactName}</p>}
          {order.supplier.phone && (
            <p>
              <bdi dir="ltr">{order.supplier.phone}</bdi>
            </p>
          )}
          {order.supplier.email && (
            <p>
              <bdi dir="ltr">{order.supplier.email}</bdi>
            </p>
          )}
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">
            {t('inventory.purchaseOrders.deliverTo')}
          </p>
          <p className="font-semibold">{localize(order.branch.name, i18n.language)}</p>
          {order.branch.address && <p>{order.branch.address}</p>}
          {order.expectedOn && (
            <p>
              {t('inventory.purchaseOrders.expectedOn')}:{' '}
              {formatDate(order.expectedOn, i18n.language)}
            </p>
          )}
        </div>
      </div>
      <OrderLines order={order} />
      {order.note && <p className="mt-4">{order.note}</p>}
      <p className="mt-6 text-xs text-slate-500">
        {order.sentAt
          ? t('inventory.purchaseOrders.sentBy', {
              name: order.sentByName ?? '–',
              when: formatDateTime(order.sentAt, i18n.language),
            })
          : t('inventory.purchaseOrders.createdBy', {
              name: order.createdByName ?? '–',
              when: formatDateTime(order.createdAt, i18n.language),
            })}
      </p>
    </div>
  );
}
