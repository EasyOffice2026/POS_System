import { type FormEvent, useState } from 'react';
import { type TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import { ApiError } from '../../lib/api';
import { useAuth } from './auth-context';

const lockedDetailsSchema = z.object({ retryAfterSeconds: z.number() });

// What went wrong, kept as data so the message follows the language if it is switched.
type LoginError =
  { kind: 'invalid' | 'rateLimited' | 'network' | 'unknown' } | { kind: 'locked'; minutes: number };

function toLoginError(error: unknown): LoginError {
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
      default:
        return { kind: 'unknown' };
    }
  }
  // fetch() rejects with a TypeError when the server cannot be reached, and with a
  // TimeoutError when it does not answer in time.
  const unreachable =
    error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError');
  return { kind: unreachable ? 'network' : 'unknown' };
}

function messageFor(error: LoginError, t: TFunction): string {
  switch (error.kind) {
    case 'invalid':
      return t('auth.errors.INVALID_CREDENTIALS');
    case 'locked':
      return `${t('auth.errors.ACCOUNT_LOCKED')} ${t('auth.errors.retryIn', { count: error.minutes })}`;
    case 'rateLimited':
      return t('auth.errors.RATE_LIMITED');
    case 'network':
      return t('auth.errors.network');
    case 'unknown':
      return t('auth.errors.unknown');
  }
}

const inputClass =
  'mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-start focus:ring-2 focus:ring-slate-400 focus:outline-none';

export function LoginPage() {
  const { t } = useTranslation();
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<LoginError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/admin';

  if (status === 'authenticated') {
    return <Navigate to={from} replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ type: 'password', email, password });
      void navigate(from, { replace: true });
    } catch (caught) {
      setError(toLoginError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500">{t('app.name')}</p>
            <h1 className="text-xl font-semibold text-slate-900">{t('auth.signInTitle')}</h1>
          </div>
          <LanguageSwitcher />
        </div>

        <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            {t('auth.email')}
            <input
              type="email"
              required
              autoComplete="username"
              dir="auto"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            {t('auth.password')}
            <input
              type="password"
              required
              autoComplete="current-password"
              dir="auto"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
            />
          </label>

          {error && (
            <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {messageFor(error, t)}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700 focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:outline-none disabled:opacity-60"
          >
            {submitting ? t('auth.submitting') : t('auth.submit')}
          </button>
        </form>
      </div>
    </main>
  );
}
