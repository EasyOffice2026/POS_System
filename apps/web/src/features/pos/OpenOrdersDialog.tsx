import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { secondaryButtonClass } from '../../components/form';
import { Price } from '../../components/Price';
import { listOpenOrders, orderKeys } from './pos-api';

interface OpenOrdersDialogProps {
  branchId: string;
  currentId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
}

// The orders still open at the branch, newest first, to pick one up again.
// See docs/specs/006-pos-terminal.md, rule 12.
export function OpenOrdersDialog({ branchId, currentId, onOpen, onClose }: OpenOrdersDialogProps) {
  const { t, i18n } = useTranslation();
  const orders = useQuery({
    queryKey: orderKeys.open(branchId),
    queryFn: () => listOpenOrders(branchId),
  });
  const time = new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-u-nu-latn' : 'en-GB', {
    timeStyle: 'short',
    hourCycle: 'h23',
  });

  return (
    <Dialog title={t('pos.openOrders.title')} onClose={onClose}>
      {orders.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {orders.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {orders.data?.data.length === 0 && (
        <p className="text-sm text-slate-500">{t('pos.openOrders.none')}</p>
      )}
      <ul className="space-y-2">
        {orders.data?.data.map((order) => (
          <li key={order.id}>
            <button
              type="button"
              aria-current={order.id === currentId ? 'true' : undefined}
              onClick={() => onOpen(order.id)}
              className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-start hover:bg-slate-50 aria-[current]:border-slate-900"
            >
              <span className="min-w-0">
                <span className="block font-medium">
                  {t('pos.order.number', { number: order.number })}
                </span>
                <span className="block text-xs text-slate-600">
                  {t(`pos.order.types.${order.type}`)} · {time.format(new Date(order.createdAt))} ·{' '}
                  {t('pos.openOrders.lines', { count: order.lineCount })}
                </span>
              </span>
              <span className="font-medium">
                <Price value={order.total} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className={secondaryButtonClass}>
          {t('common.back')}
        </button>
      </div>
    </Dialog>
  );
}
