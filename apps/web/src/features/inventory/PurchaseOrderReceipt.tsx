import {
  fromMils,
  type PurchaseOrder,
  receivePurchaseOrderRequestSchema,
  toMils,
} from '@pos/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  compactFieldClass,
  fieldClass,
  FormField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { Price, PriceInput } from '../../components/Price';
import { localize } from '../../i18n/localize';
import { fieldsFromIssues, messageFor, problemsFrom } from '../../lib/error-messages';
import { inventoryKeys, purchaseOrderKeys, receivePurchaseOrder } from './inventory-api';

interface Received {
  quantity: string;
  unitPrice: string;
}

const decimal = /^\d{1,12}(\.\d{1,3})?$/;
const totalOf = (row: Received | undefined) =>
  row && decimal.test(row.quantity.trim()) && decimal.test(row.unitPrice.trim())
    ? Math.round((toMils(row.quantity.trim()) * toMils(row.unitPrice.trim())) / 1000)
    : 0;

interface ReceiveFormProps {
  order: PurchaseOrder;
  // Called with what to say above the order, or null when going back without receiving.
  onDone: (notice: string | null) => void;
}

// What arrived for a sent order: each line filled in with what was ordered, to change where the
// delivery differs. See docs/specs/019-goods-receipt.md.
export function ReceiveForm({ order, onDone }: ReceiveFormProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Record<string, Received>>(() =>
    Object.fromEntries(
      order.lines.map((line) => [
        line.ingredient.id,
        { quantity: line.quantity, unitPrice: line.unitPrice },
      ]),
    ),
  );
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);

  const body = () => ({
    invoiceNumber,
    note,
    lines: order.lines.map((line) => ({
      ingredientId: line.ingredient.id,
      quantity: (rows[line.ingredient.id]?.quantity ?? '').trim(),
      unitPrice: (rows[line.ingredient.id]?.unitPrice ?? '').trim(),
    })),
  });
  const total = order.lines.reduce((sum, line) => sum + totalOf(rows[line.ingredient.id]), 0);

  const receive = useMutation({
    mutationFn: () => receivePurchaseOrder(order.id, body()),
    onSuccess: async (saved) => {
      queryClient.setQueryData(purchaseOrderKeys.one(order.id), saved);
      await queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      onDone(t('inventory.purchaseOrders.messages.received'));
    },
    onError: (error) => {
      const found = problemsFrom(error);
      setErrors(found.fields);
      setProblem(found.form ?? found.fields.lines ?? null);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const parsed = receivePurchaseOrderRequestSchema.safeParse(body());
    const found = parsed.success ? {} : fieldsFromIssues(parsed.error.issues);
    setErrors(found);
    if (!parsed.success) {
      setProblem(found.lines ?? null);
      return;
    }
    receive.mutate();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <h3 className="text-lg font-semibold">{t('inventory.purchaseOrders.receiveTitle')}</h3>
      <p className="text-sm text-slate-600">{t('inventory.purchaseOrders.receiveIntro')}</p>
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
              <th className="py-2 pe-3 text-end font-medium">
                {t('inventory.purchaseOrders.ordered')}
              </th>
              <th className="py-2 pe-3 text-start font-medium">
                {t('inventory.purchaseOrders.receivedQuantity')}
              </th>
              <th className="py-2 pe-3 text-start font-medium">
                {t('inventory.purchaseOrders.unitPrice')}
              </th>
              <th className="py-2 text-end font-medium">
                {t('inventory.purchaseOrders.lineTotal')}
              </th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line, index) => {
              const id = line.ingredient.id;
              const name = localize(line.ingredient.name, i18n.language);
              const unit = t(`inventory.units.${line.ingredient.unit}`);
              const row = rows[id] ?? { quantity: '', unitPrice: '' };
              const quantityId = `receive-${id}-quantity`;
              const priceId = `receive-${id}-price`;
              const quantityError = errors[`lines.${index}.quantity`];
              const priceError = errors[`lines.${index}.unitPrice`];
              const change = (patch: Partial<Received>) =>
                setRows((current) => ({ ...current, [id]: { ...row, ...patch } }));
              return (
                <tr key={id} className="border-b border-slate-100 align-top">
                  <td className="py-2 pe-3">
                    <label htmlFor={quantityId} className="font-medium">
                      {name}
                    </label>
                  </td>
                  <td className="py-2 pe-3 text-end whitespace-nowrap">
                    <bdi dir="ltr">{line.quantity}</bdi> {unit}
                  </td>
                  <td className="py-2 pe-3 whitespace-nowrap">
                    <PriceInput
                      id={quantityId}
                      value={row.quantity}
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
                      value={row.unitPrice}
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
                  <td className="py-2 text-end whitespace-nowrap">
                    <Price value={fromMils(totalOf(row))} />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="py-2 pe-3" colSpan={4}>
                {t('inventory.purchaseOrders.receivedTotal')}
              </td>
              <td className="py-2 text-end whitespace-nowrap">
                <Price value={fromMils(total)} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          id="receive-invoice"
          label={t('inventory.purchaseOrders.invoiceNumber')}
          error={errors.invoiceNumber ? messageFor(errors.invoiceNumber, t) : undefined}
        >
          <input
            id="receive-invoice"
            type="text"
            dir="ltr"
            value={invoiceNumber}
            onChange={(event) => setInvoiceNumber(event.target.value)}
            className={fieldClass}
          />
        </FormField>
        <FormField
          id="receive-note"
          label={t('inventory.purchaseOrders.note')}
          error={errors.note ? messageFor(errors.note, t) : undefined}
        >
          <input
            id="receive-note"
            type="text"
            dir="auto"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={fieldClass}
          />
        </FormField>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => onDone(null)} className={secondaryButtonClass}>
          {t('common.back')}
        </button>
        <button type="submit" disabled={receive.isPending} className={primaryButtonClass}>
          {t('inventory.purchaseOrders.putIntoStock')}
        </button>
      </div>
    </form>
  );
}

// A received order: what was ordered next to what arrived, a difference marked.
export function ReceivedLines({ order }: { order: PurchaseOrder }) {
  const { t, i18n } = useTranslation();
  const differs = 'rounded bg-amber-100 px-1 text-amber-900';
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-300 text-slate-600">
            <th className="py-2 pe-3 text-start font-medium">{t('inventory.stock.ingredient')}</th>
            <th className="py-2 pe-3 text-end font-medium">
              {t('inventory.purchaseOrders.ordered')}
            </th>
            <th className="py-2 pe-3 text-end font-medium">
              {t('inventory.purchaseOrders.receivedQuantity')}
            </th>
            <th className="py-2 pe-3 text-end font-medium">
              {t('inventory.purchaseOrders.unitPrice')}
            </th>
            <th className="py-2 text-end font-medium">{t('inventory.purchaseOrders.lineTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => {
            const unit = t(`inventory.units.${line.ingredient.unit}`);
            const quantity = line.receivedQuantity ?? '0.000';
            const price = line.receivedPrice ?? line.unitPrice;
            return (
              <tr key={line.ingredient.id} className="border-b border-slate-100">
                <td className="py-2 pe-3">{localize(line.ingredient.name, i18n.language)}</td>
                <td className="py-2 pe-3 text-end whitespace-nowrap">
                  <bdi dir="ltr">{line.quantity}</bdi> {unit}
                </td>
                <td className="py-2 pe-3 text-end whitespace-nowrap">
                  <span className={quantity === line.quantity ? '' : differs}>
                    <bdi dir="ltr">{quantity}</bdi> {unit}
                  </span>
                </td>
                <td className="py-2 pe-3 text-end whitespace-nowrap">
                  <span className={price === line.unitPrice ? '' : differs}>
                    <Price value={price} />
                  </span>
                  {price !== line.unitPrice && (
                    <span className="block text-xs text-slate-500">
                      {t('inventory.purchaseOrders.orderedAt', { price: line.unitPrice })}
                    </span>
                  )}
                </td>
                <td className="py-2 text-end whitespace-nowrap">
                  <Price value={line.receivedTotal ?? '0.000'} />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className="py-2 pe-3 text-slate-600" colSpan={4}>
              {t('inventory.purchaseOrders.orderedTotal')}
            </td>
            <td className="py-2 text-end whitespace-nowrap text-slate-600">
              <Price value={order.total} />
            </td>
          </tr>
          <tr className="font-semibold">
            <td className="py-2 pe-3" colSpan={4}>
              {t('inventory.purchaseOrders.receivedTotal')}
            </td>
            <td className="py-2 text-end whitespace-nowrap">
              <Price value={order.receivedTotal ?? '0.000'} />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
