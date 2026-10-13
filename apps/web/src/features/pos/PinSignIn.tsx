import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { z } from 'zod';
import { primaryButtonClass } from '../../components/form';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import { localize } from '../../i18n/localize';
import { ApiError } from '../../lib/api';
import { useAuth } from '../auth/auth-context';
import { emptyStaffPin, type StaffPin, StaffPinFields } from './StaffPinFields';
import type { TerminalScreen } from './TerminalGate';
import type { Terminal } from './terminal-store';

const lockedDetailsSchema = z.object({ retryAfterSeconds: z.number() });

// Kept as data, so the sentence follows the language if it is switched.
type SignInError =
  | { kind: 'invalid' | 'rateLimited' | 'branchInactive' | 'network' | 'unknown' }
  | { kind: 'locked'; minutes: number };

function toSignInError(error: unknown): SignInError {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'INVALID_CREDENTIALS':
      case 'VALIDATION_ERROR':
        return { kind: 'invalid' };
      case 'ACCOUNT_LOCKED': {
        const details = lockedDetailsSchema.safeParse(error.details);
        const seconds = details.success ? details.data.retryAfterSeconds : 60;
        return { kind: 'locked', minutes: Math.max(1, Math.ceil(seconds / 60)) };
      }
      case 'RATE_LIMITED':
        return { kind: 'rateLimited' };
      case 'BRANCH_INACTIVE':
        return { kind: 'branchInactive' };
      default:
        return { kind: 'unknown' };
    }
  }
  const unreachable =
    error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError');
  return { kind: unreachable ? 'network' : 'unknown' };
}

// The first screen of a terminal: the branch, and a staff code and PIN to sign in with.
// See docs/specs/006-pos-terminal.md, rule 2.
export function PinSignIn({ terminal, screen }: { terminal: Terminal; screen: TerminalScreen }) {
  const { t, i18n } = useTranslation();
  const { login } = useAuth();
  const [value, setValue] = useState<StaffPin>(emptyStaffPin);
  const [error, setError] = useState<SignInError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ type: 'pin', branchId: terminal.branchId, ...value });
    } catch (caught) {
      setError(toSignInError(caught));
      setValue((current) => ({ ...current, pin: '' }));
      setSubmitting(false);
    }
  }

  const message = (problem: SignInError) => {
    switch (problem.kind) {
      case 'invalid':
        return t('pos.signIn.errors.invalid');
      case 'locked':
        return `${t('auth.errors.ACCOUNT_LOCKED')} ${t('auth.errors.retryIn', { count: problem.minutes })}`;
      case 'rateLimited':
        return t('auth.errors.RATE_LIMITED');
      case 'branchInactive':
        return t('pos.signIn.errors.branchInactive');
      case 'network':
        return t('auth.errors.network');
      case 'unknown':
        return t('auth.errors.unknown');
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-slate-500">
              {terminal.brandName ? localize(terminal.brandName, i18n.language) : t('app.name')}
            </p>
            <h1 className="text-xl font-semibold text-slate-900">
              {localize(terminal.branchName, i18n.language)}
            </h1>
          </div>
          <LanguageSwitcher />
        </div>

        <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
          <StaffPinFields value={value} onChange={setValue} disabled={submitting} />

          {error && (
            <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {message(error)}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !value.staffCode || value.pin.length < 4}
            className={`${primaryButtonClass} w-full py-3 text-base`}
          >
            {submitting ? t('auth.submitting') : t('auth.submit')}
          </button>
        </form>

        <div className="mt-5 flex flex-wrap justify-between gap-2 text-sm">
          <Link to="/login" state={{ from: screen }} className="text-slate-600 underline">
            {t('pos.signIn.withEmail')}
          </Link>
          <Link to={`/pos/setup?next=${screen}`} className="text-slate-600 underline">
            {t('pos.signIn.changeBranch')}
          </Link>
        </div>
      </div>
    </main>
  );
}
