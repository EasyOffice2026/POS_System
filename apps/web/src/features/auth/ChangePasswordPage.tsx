import { changePasswordRequestSchema } from '@pos/shared';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import {
  fieldAttributes,
  fieldClass,
  FormField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import { fieldsFromIssues, messageFor, problemsFrom } from '../../lib/error-messages';
import { useAuth } from './auth-context';

// A person changes their own password. It is the first screen after sign-in while a password a
// manager gave is still in use (docs/client-decisions.md), and open to everyone from the header.
export function ChangePasswordPage() {
  const { t } = useTranslation();
  const { user, changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/admin';
  const forced = user?.mustChangePassword ?? false;

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const error = (field: string) => (problems[field] ? messageFor(problems[field], t) : undefined);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormProblem(null);
    const body = { currentPassword: current, newPassword: next };
    const result = changePasswordRequestSchema.safeParse(body);
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    if (next !== again) found.again = 'PASSWORD_MISMATCH';
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      await changePassword(body);
      void navigate(from, { replace: true });
    } catch (caught) {
      const sorted = problemsFrom(caught);
      setProblems(sorted.fields);
      setFormProblem(sorted.form);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <form
        onSubmit={(event) => void onSubmit(event)}
        noValidate
        className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{t('auth.changePassword.title')}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {forced ? t('auth.changePassword.forced') : t('auth.changePassword.intro')}
            </p>
          </div>
          <LanguageSwitcher />
        </div>

        <FormField
          id="current-password"
          label={t('auth.changePassword.current')}
          error={error('currentPassword')}
        >
          <input
            {...fieldAttributes('current-password', { error: Boolean(error('currentPassword')) })}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            className={fieldClass}
          />
        </FormField>
        <FormField
          id="new-password"
          label={t('auth.changePassword.next')}
          hint={t('auth.changePassword.hint')}
          error={error('newPassword')}
        >
          <input
            {...fieldAttributes('new-password', {
              hint: true,
              error: Boolean(error('newPassword')),
            })}
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            className={fieldClass}
          />
        </FormField>
        <FormField
          id="again-password"
          label={t('auth.changePassword.again')}
          error={error('again')}
        >
          <input
            {...fieldAttributes('again-password', { error: Boolean(error('again')) })}
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={(event) => setAgain(event.target.value)}
            className={fieldClass}
          />
        </FormField>

        {formProblem && (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {messageFor(formProblem, t)}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {forced ? (
            <button type="button" onClick={() => void logout()} className={secondaryButtonClass}>
              {t('auth.signOut')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void navigate(from, { replace: true })}
              className={secondaryButtonClass}
            >
              {t('common.cancel')}
            </button>
          )}
          <button type="submit" disabled={busy} className={primaryButtonClass}>
            {busy ? t('common.saving') : t('auth.changePassword.submit')}
          </button>
        </div>
      </form>
    </main>
  );
}
