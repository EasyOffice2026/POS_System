import type { PurchaseOrderStatus } from '@pos/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { fieldClass, primaryButtonClass } from '../../components/form';
import { Price } from '../../components/Price';
import { formatDate, formatDateTime } from '../../i18n/format';
import { localize } from '../../i18n/localize';
import { listPurchaseOrders, purchaseOrderKeys } from './inventory-api';
import { useInventoryContext } from './InventoryLayout';

const statusClass: Record<PurchaseOrderStatus, string> = {
  draft: 'bg-slate-200 text-slate-800',
  sent: 'bg-amber-100 text-amber-900',
  received: 'bg-emerald-100 text-emerald-900',
  cancelled: 'bg-slate-100 text-slate-500 line-through',
};

export function OrderStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  const { t } = useTranslation();
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass[status]}`}>
      {t(`inventory.purchaseOrders.statuses.${status}`)}
    </span>
  );
}

// The purchase orders of a branch, newest first. See docs/specs/018-purchase-orders.md.
export function PurchaseOrdersPage() {
  const { t, i18n } = useTranslation();
  const { branches, canMoveStock } = useInventoryContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const branchId =
    branches.find((branch) => branch.id === searchParams.get('branchId'))?.id ??
    branches[0]?.id ??
    null;
  // The links keep the address (a group admin's brand) with the branch on the screen.
  const linkSearch = () => {
    const next = new URLSearchParams(searchParams);
    if (branchId) next.set('branchId', branchId);
    return `?${next.toString()}`;
  };

  const orders = useQuery({
    queryKey: purchaseOrderKeys.list(branchId ?? ''),
    queryFn: () => listPurchaseOrders(branchId ?? ''),
    enabled: Boolean(branchId),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('inventory.purchaseOrders.intro')}</p>
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
        {branchId && canMoveStock && (
          <Link to={{ pathname: 'new', search: linkSearch() }} className={primaryButtonClass}>
            {t('inventory.purchaseOrders.new')}
          </Link>
        )}
      </div>

      {orders.isPending && branchId && (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      )}
      {orders.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {orders.data?.length === 0 && (
        <p className="text-sm text-slate-500">{t('inventory.purchaseOrders.empty')}</p>
      )}

      {orders.data && orders.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="py-2 pe-3 text-start font-medium">
                  {t('inventory.purchaseOrders.number')}
                </th>
                <th className="py-2 pe-3 text-start font-medium">
                  {t('inventory.purchaseOrders.supplier')}
                </th>
                <th className="py-2 pe-3 text-start font-medium">
                  {t('inventory.purchaseOrders.status')}
                </th>
                <th className="py-2 pe-3 text-end font-medium">
                  {t('inventory.purchaseOrders.total')}
                </th>
                <th className="py-2 pe-3 text-start font-medium">
                  {t('inventory.purchaseOrders.expectedOn')}
                </th>
                <th className="py-2 pe-3 text-start font-medium">
                  {t('inventory.purchaseOrders.created')}
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.data.map((order) => (
                <tr key={order.id} className="border-b border-slate-100">
                  <td className="py-2 pe-3 font-medium">
                    <Link
                      to={{ pathname: order.id, search: linkSearch() }}
                      aria-label={t('inventory.purchaseOrders.openFor', { number: order.number })}
                      className="underline-offset-2 hover:underline"
                    >
                      #{order.number}
                    </Link>
                  </td>
                  <td className="py-2 pe-3">
                    <bdi>{order.supplier.name}</bdi>
                    <span className="block text-xs text-slate-500">
                      {t('inventory.purchaseOrders.lineCount', { count: order.lineCount })}
                    </span>
                  </td>
                  <td className="py-2 pe-3">
                    <OrderStatusBadge status={order.status} />
                  </td>
                  <td className="py-2 pe-3 text-end">
                    <Price value={order.total} />
                  </td>
                  <td className="py-2 pe-3 whitespace-nowrap">
                    {order.expectedOn ? formatDate(order.expectedOn, i18n.language) : '–'}
                  </td>
                  <td className="py-2 pe-3 whitespace-nowrap">
                    {formatDateTime(order.createdAt, i18n.language)}
                    <span className="block text-xs text-slate-500">
                      {order.createdByName ?? '–'}
                    </span>
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
