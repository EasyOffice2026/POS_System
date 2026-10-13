import type { AuthUser, Permission } from '@pos/shared';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { primaryButtonClass } from '../../components/form';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import { localize } from '../../i18n/localize';
import { useAuth } from '../auth/auth-context';
import { PinSignIn } from './PinSignIn';
import { readTerminal, type Terminal } from './terminal-store';

// The screens of a terminal: the POS at /pos and the kitchen display at /kds.
export type TerminalScreen = '/pos' | '/kds';

// Whether the person belongs where this terminal is: its branch, its brand, or the whole group.
function worksAt(user: AuthUser, terminal: Terminal): boolean {
  if (user.scope === 'GROUP') return true;
  if (user.scope === 'BRAND') return user.brandId === terminal.brandId;
  return user.branchIds.includes(terminal.branchId);
}

function Message({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl bg-white p-6 shadow">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <LanguageSwitcher />
        </div>
        {children}
      </div>
    </main>
  );
}

interface TerminalGateProps {
  screen: TerminalScreen;
  // What the screen needs, and what to say to a person without it.
  permission: Permission;
  denied: (name: string) => string;
  children: (terminal: Terminal) => ReactNode;
}

// A terminal that is not set up says how to set it up; nobody signed in gets the PIN screen; a
// person who may not use the screen, or does not work at the branch, is told so. See
// docs/specs/006-pos-terminal.md, rules 1 to 3.
export function TerminalGate({ screen, permission, denied, children }: TerminalGateProps) {
  const { t, i18n } = useTranslation();
  const { status, user, logout } = useAuth();
  const [terminal] = useState(readTerminal);

  if (status === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center text-slate-500">
        {t('common.loading')}
      </main>
    );
  }

  if (!terminal) {
    return (
      <Message title={t('pos.notSetUp.title')}>
        <p className="text-sm text-slate-600">{t('pos.notSetUp.body')}</p>
        <Link
          to={`/pos/setup?next=${screen}`}
          className={`${primaryButtonClass} block text-center`}
        >
          {t('pos.notSetUp.setUp')}
        </Link>
      </Message>
    );
  }

  if (!user) return <PinSignIn terminal={terminal} screen={screen} />;

  if (!user.permissions.includes(permission) || !worksAt(user, terminal)) {
    return (
      <Message title={localize(terminal.branchName, i18n.language)}>
        <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          {user.permissions.includes(permission)
            ? t('pos.notAllowed.otherBranch', { name: user.name })
            : denied(user.name)}
        </p>
        <button
          type="button"
          onClick={() => void logout()}
          className={`${primaryButtonClass} w-full`}
        >
          {t('auth.signOut')}
        </button>
      </Message>
    );
  }

  return <>{children(terminal)}</>;
}
