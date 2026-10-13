import { type KitchenTicket, nextTicketStatus } from '@pos/shared';
import { useTranslation } from 'react-i18next';
import { localize } from '../../i18n/localize';

// After this many minutes a ticket turns amber, then red (spec 008, rule 6).
const LATE_MINUTES = 10;
const VERY_LATE_MINUTES = 20;

export const minutesSince = (iso: string, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));

interface TicketCardProps {
  ticket: KitchenTicket;
  now: Date;
  // Null when the person may only look (spec 008, criterion 6).
  onMove: ((ticket: KitchenTicket) => void) | null;
  busy: boolean;
  // The cashier marks tickets done on the POS, so a ready ticket has no button here (spec 009).
  doneByCashier?: boolean;
}

// One ticket: the order, how long it has waited, its dishes, and one big button for the next step.
export function TicketCard({ ticket, now, onMove, busy, doneByCashier = false }: TicketCardProps) {
  const { t, i18n } = useTranslation();
  const waited = minutesSince(ticket.sentAt, now);
  const done = ticket.status === 'done';
  const edge = done
    ? 'border-slate-200'
    : waited >= VERY_LATE_MINUTES
      ? 'border-red-500'
      : waited >= LATE_MINUTES
        ? 'border-amber-400'
        : ticket.status === 'new'
          ? 'border-sky-500'
          : 'border-slate-300';
  const names = (modifiers: KitchenTicket['lines'][number]['modifiers']) =>
    modifiers.map((modifier) => localize(modifier.name, i18n.language)).join(', ');
  const next = nextTicketStatus[ticket.status];

  return (
    <article
      aria-label={t('pos.order.number', { number: ticket.orderNumber })}
      className={`flex flex-col rounded-lg border-2 bg-white shadow-sm ${edge}`}
    >
      <header
        className={`flex items-start justify-between gap-2 border-b border-slate-200 px-3 py-2 ${done ? 'opacity-60' : ''}`}
      >
        <div>
          <h2 className="text-lg font-bold">
            {t('pos.order.number', { number: ticket.orderNumber })}
          </h2>
          <p className="text-xs text-slate-600">{t(`pos.order.types.${ticket.orderType}`)}</p>
        </div>
        <div className="text-end">
          <p
            className={`text-lg font-semibold ${
              !done && waited >= VERY_LATE_MINUTES
                ? 'text-red-700'
                : !done && waited >= LATE_MINUTES
                  ? 'text-amber-700'
                  : 'text-slate-700'
            }`}
          >
            {t('kds.minutes', { count: waited })}
          </p>
          <p className="text-xs font-medium text-slate-600">{t(`kds.status.${ticket.status}`)}</p>
        </div>
      </header>

      <ul className={`flex-1 space-y-1 px-3 py-2 ${done ? 'opacity-60' : ''}`}>
        {ticket.lines.map((line) => (
          <li key={line.id} className={line.voided ? 'text-slate-400' : ''}>
            <p className="font-medium">
              <span className={line.voided ? 'line-through' : ''}>
                {line.quantity} × {localize(line.name, i18n.language)}
              </span>
              {line.voided && (
                <span className="ms-2 rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white no-underline">
                  {t('kds.void')}
                </span>
              )}
            </p>
            {line.modifiers.length > 0 && (
              <p className="ps-5 text-sm text-slate-700">{names(line.modifiers)}</p>
            )}
            {line.choices.map((choice) => (
              <p key={choice.slotId} className="ps-5 text-sm text-slate-700">
                {localize(choice.name, i18n.language)}
                {choice.modifiers.length > 0 && ` (${names(choice.modifiers)})`}
              </p>
            ))}
            {line.note && <p className="ps-5 text-sm text-amber-800 italic">{line.note}</p>}
          </li>
        ))}
        {ticket.orderNote && (
          <li className="border-t border-dashed border-slate-200 pt-1 text-sm text-amber-800 italic">
            {ticket.orderNote}
          </li>
        )}
      </ul>

      {onMove && !(doneByCashier && ticket.status === 'ready') && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onMove(ticket)}
          className={`m-2 rounded-md px-4 py-3 text-base font-semibold text-white focus:ring-2 focus:ring-slate-400 focus:outline-none disabled:opacity-60 ${
            done
              ? 'bg-slate-500 hover:bg-slate-600'
              : next === 'ready'
                ? 'bg-emerald-700 hover:bg-emerald-800'
                : 'bg-slate-900 hover:bg-slate-700'
          }`}
        >
          {done
            ? t('kds.actions.recall')
            : next === 'preparing'
              ? t('kds.actions.start')
              : next === 'ready'
                ? t('kds.actions.ready')
                : t('kds.actions.done')}
        </button>
      )}
    </article>
  );
}
