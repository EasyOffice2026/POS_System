import type { FloorTable, OrderTable } from '@pos/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { FloorGrid, tableButtonClass } from '../../components/FloorGrid';
import { secondaryButtonClass } from '../../components/form';
import { getFloor, tableKeys } from '../tables/tables-api';

interface FloorDialogProps {
  branchId: string;
  // "open": a free table starts an order, a taken one opens its order. "move": only a free
  // table can be picked, for the order on the screen.
  mode: 'open' | 'move';
  currentTableId: string | null;
  onFree: (table: OrderTable) => void;
  onTaken: (orderId: string) => void;
  onClose: () => void;
}

// The areas of a floor in the order of the plan.
export const areasOf = (tables: readonly { area: string }[]) => [
  ...new Set(tables.map((table) => table.area)),
];

// The tables of the branch, free, taken or waiting to be paid, by area.
// See docs/specs/023-floor-plan.md, rule 8.
export function FloorDialog({
  branchId,
  mode,
  currentTableId,
  onFree,
  onTaken,
  onClose,
}: FloorDialogProps) {
  const { t } = useTranslation();
  const floor = useQuery({
    queryKey: tableKeys.floor(branchId),
    queryFn: () => getFloor(branchId),
    refetchInterval: 10_000,
  });
  const tables = floor.data ?? [];
  const areas = areasOf(tables);
  const [picked, setPicked] = useState<string | null>(null);
  const currentArea = tables.find((table) => table.id === currentTableId)?.area;
  const area = picked && areas.includes(picked) ? picked : (currentArea ?? areas[0] ?? '');

  function describe(table: FloorTable) {
    const name = t('pos.table.name', { name: table.name });
    if (!table.order)
      return `${name}, ${t('pos.table.free')}, ${t('pos.table.seats', { count: table.seats })}`;
    const order = `${t('pos.order.number', { number: table.order.number })}, ${table.order.total} ${t('menu.currency')}`;
    return table.order.billPrintedAt
      ? `${name}, ${order}, ${t('pos.table.billPrinted')}`
      : `${name}, ${order}`;
  }

  function renderTable(table: FloorTable) {
    const current = table.id === currentTableId;
    const colours = current
      ? 'border-slate-900 bg-slate-900 text-white'
      : !table.order
        ? 'border-emerald-600 bg-white text-slate-900 hover:bg-emerald-50'
        : table.order.billPrintedAt
          ? 'border-sky-600 bg-sky-100 text-sky-950'
          : 'border-amber-500 bg-amber-100 text-amber-950';
    const disabled = mode === 'move' && (current || table.order !== null);
    return (
      <button
        type="button"
        disabled={disabled}
        aria-label={describe(table)}
        aria-current={current ? 'true' : undefined}
        onClick={() => {
          if (table.order && mode === 'open') onTaken(table.order.id);
          else if (!table.order) onFree({ id: table.id, name: table.name, area: table.area });
        }}
        className={`${tableButtonClass(table.shape, colours)} disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <span className="text-sm">{table.name}</span>
        {table.order && (
          <span className="font-normal">
            #{table.order.number}
            {table.order.billPrintedAt && ` · ${t('pos.table.bill')}`}
          </span>
        )}
      </button>
    );
  }

  return (
    <Dialog
      title={mode === 'move' ? t('pos.table.moveTitle') : t('pos.table.title')}
      onClose={onClose}
      wide
    >
      {floor.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {floor.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {floor.isSuccess && tables.length === 0 && (
        <p className="text-sm text-slate-500">{t('pos.table.none')}</p>
      )}
      {areas.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {areas.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={name === area}
              onClick={() => setPicked(name)}
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                name === area ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              <bdi>{name}</bdi>
            </button>
          ))}
        </div>
      )}
      {tables.length > 0 && (
        <FloorGrid
          label={area}
          tables={tables.filter((table) => table.area === area)}
          renderTable={renderTable}
        />
      )}
      {tables.length > 0 && (
        <p className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">
          <span>
            <span className="me-1 inline-block h-3 w-3 rounded-sm border-2 border-emerald-600 bg-white align-middle" />
            {t('pos.table.free')}
          </span>
          <span>
            <span className="me-1 inline-block h-3 w-3 rounded-sm border-2 border-amber-500 bg-amber-100 align-middle" />
            {t('pos.table.taken')}
          </span>
          <span>
            <span className="me-1 inline-block h-3 w-3 rounded-sm border-2 border-sky-600 bg-sky-100 align-middle" />
            {t('pos.table.billPrinted')}
          </span>
        </p>
      )}
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className={secondaryButtonClass}>
          {t('common.back')}
        </button>
      </div>
    </Dialog>
  );
}
