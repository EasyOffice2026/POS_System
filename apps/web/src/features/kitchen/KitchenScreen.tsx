import { type KitchenTicket, nextTicketStatus } from '@pos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackOfficeLink } from '../../components/BackOfficeLink';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import { localize } from '../../i18n/localize';
import { ApiError } from '../../lib/api';
import { useAuth } from '../auth/auth-context';
import { useNow } from '../menu/use-now';
import { SETTINGS_REFRESH_MS } from '../pos/OrderScreen';
import { useBrandSettings } from '../settings/settings-api';
import type { Terminal } from '../pos/terminal-store';
import { kitchenKeys, listTickets, moveTicket } from './kitchen-api';
import { TicketCard } from './TicketCard';

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

  const all = tickets.data ?? [];
  const open = all.filter((ticket) => ticket.status !== 'done');
  const done = all.filter((ticket) => ticket.status === 'done');
  const clock = new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-u-nu-latn' : 'en-GB', {
    timeStyle: 'short',
    hourCycle: 'h23',
  }).format(now);

  return (
    <div className="flex min-h-screen flex-col bg-slate-800 text-slate-900">
      <header className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 px-4 py-2 text-white">
        <div className="min-w-0">
          <p className="text-xs text-slate-300">{t('kds.title')}</p>
          <p className="font-semibold">
            {localize(terminal.branchName, i18n.language)}
            {terminal.stationName && (
              <span className="font-normal text-slate-300">
                {' · '}
                {localize(terminal.stationName, i18n.language)}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-200">{t('kds.waiting', { count: open.length })}</span>
          <span className="text-sm font-medium" dir="ltr">
            {clock}
          </span>
          <span className="text-sm text-slate-300">{user?.name}</span>
          <BackOfficeLink className="rounded-md border border-slate-500 px-3 py-1 text-sm font-medium text-white hover:bg-slate-700 focus:ring-2 focus:ring-slate-400 focus:outline-none" />
          <div className="rounded-md bg-white">
            <LanguageSwitcher />
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-md bg-white px-3 py-1 text-sm font-medium text-slate-900 hover:bg-slate-200"
          >
            {t('auth.signOut')}
          </button>
        </div>
      </header>

      {problem && (
        <p role="alert" className="bg-amber-100 px-4 py-2 text-sm text-amber-900">
          {t(`kds.problems.${problem}`)}
        </p>
      )}
      {tickets.isError && !tickets.data && (
        <p role="alert" className="bg-red-100 px-4 py-2 text-sm text-red-800">
          {t('common.loadError')}
        </p>
      )}

      <main className="flex-1 p-3">
        {tickets.isPending && <p className="text-slate-300">{t('common.loading')}</p>}
        {tickets.data && open.length === 0 && (
          <p className="py-12 text-center text-lg text-slate-300">{t('kds.empty')}</p>
        )}
        <section
          aria-label={t('kds.openTickets')}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {open.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              now={now}
              busy={busy === ticket.id}
              onMove={canMove ? (chosen) => void move(chosen) : null}
              doneByCashier={doneByCashier}
            />
          ))}
        </section>
      </main>

      {done.length > 0 && (
        <section
          aria-label={t('kds.doneTickets')}
          className="border-t border-slate-700 bg-slate-900 p-3"
        >
          <h2 className="mb-2 text-sm font-medium text-slate-300">{t('kds.doneTickets')}</h2>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {done.map((ticket) => (
              <div key={ticket.id} className="w-64 shrink-0">
                <TicketCard
                  ticket={ticket}
                  now={now}
                  busy={busy === ticket.id}
                  onMove={canMove ? (chosen) => void move(chosen) : null}
                  doneByCashier={doneByCashier}
                />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
