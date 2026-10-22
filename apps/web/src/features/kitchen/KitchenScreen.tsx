import { type KitchenTicket, nextTicketStatus } from '@pos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChefHat, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackOfficeLink } from '../../components/BackOfficeLink';
import { BrandMark } from '../../components/BrandMark';
import { useBrandColor } from '../../lib/use-brand-color';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import { localize } from '../../i18n/localize';
import { ApiError } from '../../lib/api';
import { useAuth } from '../auth/auth-context';
import { getBranchMenu, menuKeys } from '../menu/menu-api';
import { useNow } from '../menu/use-now';
import { SETTINGS_REFRESH_MS } from '../pos/OrderScreen';
import { useBrandSettings } from '../settings/settings-api';
import type { Terminal } from '../pos/terminal-store';
import { kitchenKeys, listTickets, moveTicket } from './kitchen-api';
import { minutesSince, STALE_MINUTES, stageColor, TicketCard } from './TicketCard';

// How often the screen asks for the tickets (spec 008, rule 7).
export const KITCHEN_REFRESH_MS = 5_000;

type Problem = 'changed' | 'network' | 'unknown';

// The kitchen display of a branch: the tickets to make, oldest first, and the ones just done.
// See docs/specs/008-kitchen-display.md.
export function KitchenScreen({ terminal }: { terminal: Terminal }) {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const now = useNow(15_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const canMove = user?.permissions.includes('kitchen:write') ?? false;
  const stationId = terminal.stationId ?? null;
  const key = kitchenKeys.tickets(terminal.branchId, stationId);
  // Who marks a ticket done (spec 009, rule 7).
  const settings = useBrandSettings(terminal.brandId, SETTINGS_REFRESH_MS);
  const doneByCashier = settings.data?.ticketDoneBy === 'cashier';

  const tickets = useQuery({
    queryKey: key,
    queryFn: () => listTickets(terminal.branchId, stationId),
    refetchInterval: KITCHEN_REFRESH_MS,
  });

  async function move(ticket: KitchenTicket) {
    setBusy(ticket.id);
    setProblem(null);
    try {
      const moved = await moveTicket(ticket.id, ticket.status, nextTicketStatus[ticket.status]);
      queryClient.setQueryData<KitchenTicket[]>(key, (current) =>
        current?.map((candidate) => (candidate.id === moved.id ? moved : candidate)),
      );
    } catch (error) {
      if (error instanceof ApiError)
        setProblem(error.code === 'TICKET_CHANGED' ? 'changed' : 'unknown');
      else setProblem(error instanceof TypeError ? 'network' : 'unknown');
    } finally {
      setBusy(null);
      void queryClient.invalidateQueries({ queryKey: key });
    }
  }

  // A branch can work from printed slips instead (docs/specs/027-kitchen-screen-and-slip.md).
  const menu = useQuery({
    queryKey: menuKeys.branchMenu(terminal.branchId),
    queryFn: () => getBranchMenu(terminal.branchId),
    refetchInterval: KITCHEN_REFRESH_MS,
  });
  const screenOff = menu.data?.kitchen.screen === false;
  useBrandColor(menu.data?.brand.color);

  // Tickets sent before the screen was switched off are not shown: the branch works from slips.
  const all = screenOff ? [] : (tickets.data ?? []);
  const open = all.filter((ticket) => ticket.status !== 'done');
  const done = all.filter((ticket) => ticket.status === 'done');
  // A ticket left for more than a day was forgotten; it waits in its own row, out of the way.
  const stale = open.filter((ticket) => minutesSince(ticket.sentAt, now) >= STALE_MINUTES);
  const current = open.filter((ticket) => minutesSince(ticket.sentAt, now) < STALE_MINUTES);
  const lateAfterMinutes = menu.data?.kitchen.lateAfterMinutes ?? 12;
  const countOf = (status: KitchenTicket['status']) =>
    current.filter((ticket) => ticket.status === status).length;
  const card = (ticket: KitchenTicket) => (
    <TicketCard
      key={ticket.id}
      ticket={ticket}
      now={now}
      lateAfterMinutes={lateAfterMinutes}
      busy={busy === ticket.id}
      onMove={canMove ? (chosen) => void move(chosen) : null}
      doneByCashier={doneByCashier}
    />
  );
  const darkButton =
    'inline-flex min-h-11 items-center gap-2 rounded-control border border-kds-line bg-kds-card px-3 text-sm font-semibold text-kds-ink hover:bg-kds-line focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none [&_svg]:size-[18px]';
  const clock = new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-u-nu-latn' : 'en-GB', {
    timeStyle: 'short',
    hourCycle: 'h23',
  }).format(now);

  return (
    <div className="flex min-h-screen flex-col bg-kds-page text-kds-ink">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-kds-line px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <BrandMark
            name={terminal.brandName ? localize(terminal.brandName, i18n.language) : t('kds.title')}
            logoUrl={menu.data?.brand.logoUrl}
          />
          <div className="min-w-0">
            <p className="leading-tight font-bold">
              {t('kds.title')} · {localize(terminal.branchName, i18n.language)}
              {terminal.stationName && (
                <span className="font-semibold text-kds-ink-2">
                  {' · '}
                  {localize(terminal.stationName, i18n.language)}
                </span>
              )}
            </p>
            <p className="text-sm text-kds-ink-2">
              {t('kds.lateAfter', { count: lateAfterMinutes })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* For screen readers: how many tickets wait, said when it changes. */}
          <p className="sr-only" aria-live="polite">
            {t('kds.waiting', { count: open.length })}
          </p>
          {!screenOff && (
            <div className="flex flex-wrap gap-2" aria-hidden="true">
              {(['new', 'preparing', 'ready'] as const).map((status) => (
                <span
                  key={status}
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-kds-line bg-kds-card px-3.5 text-sm font-semibold"
                >
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: stageColor[status] }}
                  />
                  {`${t(`kds.status.${status}`)} ${countOf(status)}`}
                </span>
              ))}
            </div>
          )}
          <span className="num px-1 text-[1.75rem] leading-none font-bold" dir="ltr">
            {clock}
          </span>
          <BackOfficeLink className={darkButton} />
          <LanguageSwitcher className={darkButton} />
          <button type="button" onClick={() => void logout()} className={darkButton}>
            <LogOut aria-hidden="true" />
            {t('auth.signOut')}
          </button>
        </div>
      </header>

      {problem && (
        <p role="alert" className="bg-warn-soft px-5 py-2 text-sm font-medium text-warn">
          {t(`kds.problems.${problem}`)}
        </p>
      )}
      {tickets.isError && !tickets.data && (
        <p role="alert" className="bg-danger-soft px-5 py-2 text-sm font-medium text-danger">
          {t('common.loadError')}
        </p>
      )}

      <main className="flex-1 p-5">
        {screenOff && (
          <p role="status" className="mx-auto max-w-xl py-16 text-center text-lg text-kds-ink-2">
            {t('kds.screenOff')}
          </p>
        )}
        {tickets.isPending && <p className="text-kds-ink-2">{t('common.loading')}</p>}
        {tickets.data && current.length === 0 && !screenOff && (
          <div className="flex flex-col items-center gap-3 py-20 text-center text-kds-ink-2">
            <ChefHat aria-hidden="true" className="size-10" />
            <p className="text-lg">{t('kds.empty')}</p>
          </div>
        )}
        <section
          aria-label={t('kds.openTickets')}
          className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {current.map(card)}
        </section>
      </main>

      {stale.length > 0 && (
        <details className="border-t border-kds-line px-5 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-kds-ink-2">
            {t('kds.stale', { count: stale.length })}
          </summary>
          <div className="mt-3 grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {stale.map(card)}
          </div>
        </details>
      )}

      {done.length > 0 && (
        <section aria-label={t('kds.doneTickets')} className="border-t border-kds-line px-5 py-3">
          <h2 className="mb-2 text-sm font-semibold text-kds-ink-2">{t('kds.doneTickets')}</h2>
          <div className="flex gap-4 overflow-x-auto pb-1">
            {done.map((ticket) => (
              <div key={ticket.id} className="w-72 shrink-0">
                {card(ticket)}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
