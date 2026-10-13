import { type AdminUser, type CredentialType, passwordProblem, pinProblem } from '@pos/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FormField,
  fieldAttributes,
  fieldClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { messageFor, problemsFrom } from '../../lib/error-messages';
import { setCredentials } from './users-api';

// Sets a new password or PIN for somebody. Without a typed value the server makes one, and it is
// shown here once.
export function CredentialsPanel({ user }: { user: AdminUser }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const canPin = Boolean(user.staffCode) && user.role.scope === 'BRANCH';
  const canPassword = Boolean(user.email);
  const [type, setType] = useState<CredentialType>(canPin || !canPassword ? 'pin' : 'password');
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<
    { kind: 'generated'; type: CredentialType; value: string } | { kind: 'done' } | null
  >(null);
  const [copied, setCopied] = useState(false);

  const allowed = type === 'pin' ? canPin : canPassword;
  const blockedReason = !allowed
    ? type === 'pin'
      ? user.staffCode
        ? t('users.credentials.pinOnlyBranch')
        : t('users.credentials.needsStaffCode')
      : t('users.credentials.needsEmail')
    : null;

  const save = useMutation({
    mutationFn: () => setCredentials(user.id, { type, ...(value ? { value } : {}) }),
    onSuccess: async (result) => {
      setValue('');
      setCopied(false);
      setOutcome(
        result.generatedValue
          ? { kind: 'generated', type: result.type, value: result.generatedValue }
          : { kind: 'done' },
      );
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      await queryClient.invalidateQueries({ queryKey: ['user', user.id] });
    },
    onError: (error) => {
      const { fields, form } = problemsFrom(error);
      setProblem(fields.value ?? fields.type ?? form ?? 'saveError');
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setOutcome(null);
    setProblem(null);

    const found = value ? (type === 'pin' ? pinProblem(value) : passwordProblem(value)) : null;
    if (found) {
      setProblem(found);
      return;
    }
    save.mutate();
  }

  async function copyValue(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Copying is a convenience. The value is still on the screen.
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold">{t('users.credentials.title')}</h2>

      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">
            {t('users.credentials.type')}
          </legend>
          <div className="mt-1 flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="credential-type"
                checked={type === 'pin'}
                onChange={() => {
                  setType('pin');
                  setProblem(null);
                }}
              />
              {t('users.credentials.typePin')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="credential-type"
                checked={type === 'password'}
                onChange={() => {
                  setType('password');
                  setProblem(null);
                }}
              />
              {t('users.credentials.typePassword')}
            </label>
          </div>
        </fieldset>

        {blockedReason && <p className="text-sm text-amber-800">{blockedReason}</p>}

        <FormField
          id="credential-value"
          label={t('users.credentials.value')}
          hint={t('users.credentials.valueHint')}
          error={problem ? messageFor(problem, t) : undefined}
        >
          <input
            {...fieldAttributes('credential-value', { hint: true, error: Boolean(problem) })}
            type="text"
            dir="ltr"
            autoComplete="off"
            inputMode={type === 'pin' ? 'numeric' : 'text'}
            value={value}
            disabled={!allowed}
            onChange={(event) => setValue(event.target.value)}
            className={fieldClass}
          />
        </FormField>

        <button type="submit" disabled={!allowed || save.isPending} className={primaryButtonClass}>
          {save.isPending ? t('common.saving') : t('users.credentials.set')}
        </button>
      </form>

      {outcome?.kind === 'done' && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {t('users.credentials.done')}
        </p>
      )}

      {outcome?.kind === 'generated' && (
        <div role="status" className="space-y-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            {outcome.type === 'pin'
              ? t('users.credentials.generatedPin')
              : t('users.credentials.generatedPassword')}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <code dir="ltr" className="rounded bg-white px-3 py-1 text-base font-semibold">
              {outcome.value}
            </code>
            <button
              type="button"
              onClick={() => void copyValue(outcome.value)}
              className={secondaryButtonClass}
            >
              {copied ? t('common.copied') : t('common.copy')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
