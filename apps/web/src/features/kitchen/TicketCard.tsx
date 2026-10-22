import { type KitchenTicket, nextTicketStatus } from '@pos/shared';
import { Bike, Check, Flame, RotateCcw, ShoppingBag, UtensilsCrossed } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { localize } from '../../i18n/localize';

// A ticket waiting longer than a day was forgotten: it goes to the stale row (redesign, K1).
export const STALE_MINUTES = 24 * 60;

export const minutesSince = (iso: string, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));

// "7 min", then "1 h 05": a cook reads it at a glance.
export function useWaitText() {
  const { t } = useTranslation();
  return (minutes: number) =>
    minutes < 60
      ? t('kds.minutes', { count: minutes })
      : t('kds.hours', {
          hours: Math.floor(minutes / 60),
          minutes: String(minutes % 60).padStart(2, '0'),
        });
}

// The colour of each stage, the same on the bar, the label and the counts in the header.
export const stageColor: Record<KitchenTicket['status'], string> = {
  new: 'var(--color-stage-new)',
  preparing: 'var(--color-stage-preparing)',
  ready: 'var(--color-stage-ready)',
  done: 'var(--color-kds-line)',
};

const typeIcon: Record<string, ReactNode> = {
  dine_in: <UtensilsCrossed aria-hidden="true" />,
  takeaway: <ShoppingBag aria-hidden="true" />,
  delivery: <Bike aria-hidden="true" />,
};

interface TicketCardProps {
  ticket: KitchenTicket;
  now: Date;
  // After this many minutes the ticket is late and turns red (the branch's setting).
  lateAfterMinutes: number;
  // Null when the person may only look (spec 008, criterion 6).
  onMove: ((ticket: KitchenTicket) => void) | null;
  busy: boolean;
  // The cashier marks tickets done on the POS, so a ready ticket has no button here (spec 009).
  doneByCashier?: boolean;
}

// One ticket: the order number first, how long it has waited, its dishes, and one big button in
// the colour of the stage it leads to.
export function TicketCard({
  ticket,
  now,
  lateAfterMinutes,
  onMove,
  busy,
  doneByCashier = false,
}: TicketCardProps) {
  const { t, i18n } = useTranslation();
  const waitText = useWaitText();
  const waited = minutesSince(ticket.sentAt, now);
  const done = ticket.status === 'done';
  const late = !done && ticket.status !== 'ready' && waited >= lateAfterMinutes;
  const accent = late ? 'var(--color-stage-late)' : stageColor[ticket.status];
  const names = (modifiers: KitchenTicket['lines'][number]['modifiers']) =>
    modifiers.map((modifier) => localize(modifier.name, i18n.language)).join(', ');
  const next = nextTicketStatus[ticket.status];
  const number = t('pos.order.number', { number: ticket.orderNumber });

  return (
    <article
      aria-label={number}
      className={`flex flex-col overflow-hidden rounded-card border bg-kds-card text-kds-ink ${
        late ? 'border-stage-late shadow-[0_0_0_1px_var(--color-stage-late)]' : 'border-kds-line'
      } ${done ? 'opacity-70' : ''}`}
    >
      <div aria-hidden="true" className="h-1.5" style={{ background: accent }} />
      <header className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1 border-b border-kds-line px-4 pt-3 pb-2.5">
        <h2 className="num text-[2rem] leading-none font-bold">#{ticket.orderNumber}</h2>
        <p className="num text-xl font-bold" style={late ? { color: accent } : undefined}>
          {waitText(waited)}
        </p>
        <p className="flex min-w-0 items-center gap-1.5 text-sm text-kds-ink-2 [&_svg]:size-4 [&_svg]:shrink-0">
          {typeIcon[ticket.orderType]}
          <span>{t(`pos.order.types.${ticket.orderType}`)}</span>
          {ticket.tableName && (
            <span className="font-semibold text-kds-ink">
              · {t('pos.table.name', { name: ticket.tableName })}
            </span>
          )}
        </p>
        <p className="text-xs font-bold tracking-wider uppercase" style={{ color: accent }}>
          {late ? t('kds.late') : t(`kds.status.${ticket.status}`)}
        </p>
      </header>

      <ul className="flex-1 space-y-2.5 px-4 py-3">
        {ticket.lines.map((line) => (
          <li key={line.id} className={line.voided ? 'text-kds-ink-2' : ''}>
            <p className="text-xl leading-snug font-semibold">
              <span className={line.voided ? 'line-through' : ''}>
                <span className="num">{line.quantity} ×</span> {localize(line.name, i18n.language)}
              </span>
              {line.voided && (
                <span className="ms-2 rounded bg-stage-late px-1.5 py-0.5 align-middle text-xs font-bold text-kds-page no-underline">
                  {t('kds.void')}
                </span>
              )}
            </p>
            {line.modifiers.length > 0 && (
              <p className="text-[15px] text-kds-ink-2">{names(line.modifiers)}</p>
            )}
            {line.choices.map((choice) => (
              <p key={choice.slotId} className="text-[15px] text-kds-ink-2">
                {localize(choice.name, i18n.language)}
                {choice.modifiers.length > 0 && ` (${names(choice.modifiers)})`}
              </p>
            ))}
            {line.note && (
              <p className="text-[15px] font-semibold text-stage-preparing italic">{line.note}</p>
            )}
          </li>
        ))}
        {ticket.orderNote && (
          <li className="border-t border-dashed border-kds-line pt-2 text-[15px] font-semibold text-stage-preparing italic">
            {ticket.orderNote}
          </li>
        )}
      </ul>

      {onMove && !(doneByCashier && ticket.status === 'ready') && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onMove(ticket)}
          className="mx-3 mb-3 flex min-h-14 items-center justify-center gap-2 rounded-control text-lg font-bold text-kds-page hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none disabled:opacity-60 [&_svg]:size-5"
          style={{
            background: done
              ? 'var(--color-kds-ink-2)'
              : next === 'preparing'
                ? 'var(--color-stage-preparing)'
                : next === 'ready'
                  ? 'var(--color-stage-ready)'
                  : 'var(--color-kds-ink)',
          }}
        >
          {done ? (
            <RotateCcw aria-hidden="true" />
          ) : next === 'preparing' ? (
            <Flame aria-hidden="true" />
          ) : (
            <Check aria-hidden="true" />
          )}
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
