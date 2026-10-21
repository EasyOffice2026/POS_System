import type { Order } from '@pos/shared';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../i18n/format';
import { localize } from '../../i18n/localize';
import type { Terminal } from './terminal-store';

interface KitchenSlipProps {
  order: Order;
  // The dishes sent at this moment; the slip lists only these.
  lineIds: string[];
  terminal: Terminal;
}

// The slip handed to the kitchen when the branch works without a kitchen screen, or wants paper
// as well: big type, no prices (docs/specs/027-kitchen-screen-and-slip.md, rule 4).
export function KitchenSlip({ order, lineIds, terminal }: KitchenSlipProps) {
  const { t, i18n } = useTranslation();
  const wanted = new Set(lineIds);
  const lines = order.lines.filter((line) => wanted.has(line.id) && line.status !== 'voided');

  return (
    <div className="mx-auto max-w-xs space-y-3 text-slate-900" data-testid="kitchen-slip">
      <div className="text-center">
        <p className="text-sm font-semibold uppercase">{t('pos.slip.title')}</p>
        <p className="text-xs">{localize(terminal.branchName, i18n.language)}</p>
        <p className="mt-1 text-2xl font-bold">{t('pos.order.number', { number: order.number })}</p>
        <p className="text-sm font-semibold">
          {t(`pos.order.types.${order.type}`)}
          {order.table && ` · ${t('pos.table.name', { name: order.table.name })}`}
        </p>
        <p className="text-xs">{formatDateTime(new Date().toISOString(), i18n.language)}</p>
      </div>

      <ul className="space-y-2 border-y border-dashed border-slate-400 py-2">
        {lines.map((line) => (
          <li key={line.id}>
            <p className="text-lg font-semibold">
              {line.quantity} × {localize(line.name, i18n.language)}
            </p>
            {line.modifiers.length > 0 && (
              <p className="ps-4 text-sm">
                {line.modifiers
                  .map((modifier) => localize(modifier.name, i18n.language))
                  .join(', ')}
              </p>
            )}
            {line.choices.map((choice) => (
              <p key={choice.slotId} className="ps-4 text-sm">
                {localize(choice.name, i18n.language)}
              </p>
            ))}
            {line.note && <p className="ps-4 text-sm italic">{line.note}</p>}
          </li>
        ))}
      </ul>

      {order.note && (
        <p className="text-sm">
          <span className="font-semibold">{t('pos.slip.note')}</span> {order.note}
        </p>
      )}
    </div>
  );
}
