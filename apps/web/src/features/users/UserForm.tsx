import {
  type AdminUser,
  type AuthUser,
  type Branch,
  type Brand,
  type Language,
  passwordProblem,
  pinProblem,
  type RoleInfo,
  type RoleKey,
  type UpdateUserRequest,
} from '@pos/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import {
  FormField,
  fieldAttributes,
  fieldClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { localize } from '../../i18n/localize';
import { messageFor, problemsFrom } from '../../lib/error-messages';
import { createUser, type CreateUserInput, updateUser } from './users-api';

interface FormState {
  name: string;
  email: string;
  staffCode: string;
  roleKey: RoleKey | '';
  brandId: string;
  branchIds: string[];
  preferredLang: Language;
  password: string;
  pin: string;
}

function initialState(existing: AdminUser | null, me: AuthUser): FormState {
  if (existing) {
    return {
      name: existing.name,
      email: existing.email ?? '',
      staffCode: existing.staffCode ?? '',
      roleKey: existing.role.key,
      brandId: existing.brandId ?? '',
      branchIds: existing.branchIds,
      preferredLang: existing.preferredLang,
      password: '',
      pin: '',
    };
  }
  return {
    name: '',
    email: '',
    staffCode: '',
    roleKey: '',
    brandId: me.scope === 'GROUP' ? '' : (me.brandId ?? ''),
    branchIds: [],
    preferredLang: 'en',
    password: '',
    pin: '',
  };
}

const emailSchema = z.email();

// The problems the person can fix on this screen, as codes. The server checks everything again.
function validate(form: FormState, scope: RoleInfo['scope'] | undefined, needsBrand: boolean) {
  const problems: Record<string, string> = {};
  const email = form.email.trim();
  const staffCode = form.staffCode.trim();

  if (!form.name.trim()) problems.name = 'required';
  if (!form.roleKey) problems.roleKey = 'required';
  if (email && !emailSchema.safeParse(email).success) problems.email = 'emailInvalid';
  if (!email && !staffCode) problems.email = 'EMAIL_OR_STAFF_CODE_REQUIRED';
  if (needsBrand && !form.brandId) problems.brandId = 'BRAND_REQUIRED';
  if (scope === 'BRANCH' && form.branchIds.length === 0) problems.branchIds = 'BRANCH_REQUIRED';

  const password = form.password ? passwordProblem(form.password) : null;
  if (password) problems.password = password;
  const pin = form.pin ? pinProblem(form.pin) : null;
  if (pin) problems.pin = pin;
  return problems;
}

function newUserBody(
  form: FormState,
  scope: RoleInfo['scope'] | undefined,
  needsBrand: boolean,
): CreateUserInput {
  const email = form.email.trim();
  const staffCode = form.staffCode.trim();

  return {
    name: form.name.trim(),
    roleKey: form.roleKey as RoleKey,
    preferredLang: form.preferredLang,
    branchIds: scope === 'BRANCH' ? form.branchIds : [],
    ...(email ? { email } : {}),
    ...(staffCode ? { staffCode } : {}),
    ...(needsBrand ? { brandId: form.brandId } : {}),
    ...(email && form.password ? { password: form.password } : {}),
    ...(staffCode && scope === 'BRANCH' && form.pin ? { pin: form.pin } : {}),
  };
}

// Only what the person changed, so the audit log shows a true list of changes.
function changesFrom(form: FormState, existing: AdminUser): UpdateUserRequest {
  const changes: UpdateUserRequest = {};
  const email = form.email.trim();
  const staffCode = form.staffCode.trim();

  if (form.name.trim() !== existing.name) changes.name = form.name.trim();
  if (email !== (existing.email ?? '')) changes.email = email || null;
  if (staffCode !== (existing.staffCode ?? '')) changes.staffCode = staffCode || null;
  if (form.roleKey && form.roleKey !== existing.role.key) changes.roleKey = form.roleKey;
  if (form.preferredLang !== existing.preferredLang) changes.preferredLang = form.preferredLang;

  const before = [...existing.branchIds].sort().join();
  if ([...form.branchIds].sort().join() !== before) changes.branchIds = form.branchIds;
  return changes;
}

interface UserFormProps {
  existing: AdminUser | null;
  me: AuthUser;
  roles: RoleInfo[];
  brands: Brand[];
  branches: Branch[];
}

export function UserForm({ existing, me, roles, brands, branches }: UserFormProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(() => initialState(existing, me));
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isSelf = existing?.id === me.id;
  const selectedRole = roles.find((role) => role.key === form.roleKey);
  const scope = selectedRole?.scope;
  // Only a group admin creating somebody picks the brand. Otherwise it is fixed.
  const needsBrand = !existing && me.scope === 'GROUP' && scope !== undefined && scope !== 'GROUP';
  const brandId = existing ? existing.brandId : me.scope === 'GROUP' ? form.brandId : me.brandId;
  const branchOptions = branches.filter((branch) => branch.brandId === brandId);
  const roleOptions = roles.filter((role) => role.assignable || role.key === existing?.role.key);

  const set = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!existing) return createUser(newUserBody(form, scope, needsBrand));
      return updateUser(existing.id, changesFrom(form, existing));
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(['user', result.id], result);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      if (!existing) {
        void navigate('/admin/users', { state: { notice: 'created' } });
      } else {
        setSaved(true);
      }
    },
    onError: (error) => {
      const found = problemsFrom(error);
      setProblems(found.fields);
      setFormProblem(found.form);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    setFormProblem(null);

    const found = validate(form, scope, needsBrand);
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    if (existing && Object.keys(changesFrom(form, existing)).length === 0) {
      setSaved(true);
      return;
    }
    save.mutate();
  }

  const error = (field: string) => (problems[field] ? messageFor(problems[field], t) : undefined);

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      <FormField id="user-name" label={t('users.form.name')} error={error('name')}>
        <input
          {...fieldAttributes('user-name', { error: Boolean(problems.name) })}
          type="text"
          dir="auto"
          value={form.name}
          onChange={(event) => set('name', event.target.value)}
          className={fieldClass}
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="user-email"
          label={t('users.form.email')}
          hint={t('users.form.signInHint')}
          error={error('email')}
        >
          <input
            {...fieldAttributes('user-email', { hint: true, error: Boolean(problems.email) })}
            type="email"
            dir="auto"
            autoComplete="off"
            value={form.email}
            onChange={(event) => set('email', event.target.value)}
            className={fieldClass}
          />
        </FormField>

        <FormField
          id="user-staff-code"
          label={t('users.form.staffCode')}
          hint={t('users.form.staffCodeHint')}
          error={error('staffCode')}
        >
          <input
            {...fieldAttributes('user-staff-code', {
              hint: true,
              error: Boolean(problems.staffCode),
            })}
            type="text"
            dir="auto"
            autoComplete="off"
            value={form.staffCode}
            onChange={(event) => set('staffCode', event.target.value)}
            className={fieldClass}
          />
        </FormField>
      </div>

      <FormField
        id="user-role"
        label={t('users.form.role')}
        hint={isSelf ? t('users.form.yourOwnRole') : undefined}
        error={error('roleKey')}
      >
        <select
          {...fieldAttributes('user-role', { hint: isSelf, error: Boolean(problems.roleKey) })}
          value={form.roleKey}
          disabled={isSelf}
          onChange={(event) => {
            const roleKey = event.target.value as RoleKey | '';
            const next = roles.find((role) => role.key === roleKey);
            setForm((current) => ({
              ...current,
              roleKey,
              branchIds: next?.scope === 'BRANCH' ? current.branchIds : [],
            }));
            setSaved(false);
          }}
          className={fieldClass}
        >
          <option value="">{t('users.form.chooseRole')}</option>
          {roleOptions.map((role) => (
            <option key={role.key} value={role.key}>
              {t(`roles.${role.key}`)}
            </option>
          ))}
        </select>
      </FormField>

      {needsBrand && (
        <FormField id="user-brand" label={t('users.form.brand')} error={error('brandId')}>
          <select
            {...fieldAttributes('user-brand', { error: Boolean(problems.brandId) })}
            value={form.brandId}
            onChange={(event) => {
              setForm((current) => ({ ...current, brandId: event.target.value, branchIds: [] }));
              setSaved(false);
            }}
            className={fieldClass}
          >
            <option value="">{t('users.form.chooseBrand')}</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {localize(brand.name, i18n.language)}
              </option>
            ))}
          </select>
        </FormField>
      )}

      {scope === 'BRANCH' && (
        <fieldset aria-describedby={problems.branchIds ? 'user-branches-error' : undefined}>
          <legend className="text-sm font-medium text-slate-700">{t('users.form.branches')}</legend>
          {branchOptions.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">{t('users.form.noBranches')}</p>
          ) : (
            <div className="mt-1 space-y-1">
              {branchOptions.map((branch) => (
                <label key={branch.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.branchIds.includes(branch.id)}
                    onChange={(event) =>
                      set(
                        'branchIds',
                        event.target.checked
                          ? [...form.branchIds, branch.id]
                          : form.branchIds.filter((id) => id !== branch.id),
                      )
                    }
                  />
                  {localize(branch.name, i18n.language)}
                </label>
              ))}
            </div>
          )}
          {problems.branchIds && (
            <p id="user-branches-error" className="mt-1 text-sm text-red-700">
              {error('branchIds')}
            </p>
          )}
        </fieldset>
      )}

      <FormField id="user-language" label={t('users.form.language')}>
        <select
          {...fieldAttributes('user-language', {})}
          value={form.preferredLang}
          onChange={(event) => set('preferredLang', event.target.value as Language)}
          className={fieldClass}
        >
          <option value="en">{t('language.english')}</option>
          <option value="ar">{t('language.arabic')}</option>
        </select>
      </FormField>

      {!existing && form.email.trim() !== '' && (
        <FormField
          id="user-password"
          label={t('users.form.password')}
          hint={t('users.form.initialPasswordHint')}
          error={error('password')}
        >
          <input
            {...fieldAttributes('user-password', { hint: true, error: Boolean(problems.password) })}
            type="text"
            dir="ltr"
            autoComplete="off"
            value={form.password}
            onChange={(event) => set('password', event.target.value)}
            className={fieldClass}
          />
        </FormField>
      )}

      {!existing && form.staffCode.trim() !== '' && scope === 'BRANCH' && (
        <FormField
          id="user-pin"
          label={t('users.form.pin')}
          hint={t('users.form.initialPinHint')}
          error={error('pin')}
        >
          <input
            {...fieldAttributes('user-pin', { hint: true, error: Boolean(problems.pin) })}
            type="text"
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            value={form.pin}
            onChange={(event) => set('pin', event.target.value)}
            className={fieldClass}
          />
        </FormField>
      )}

      {formProblem && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(formProblem, t)}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {t('users.messages.saved')}
        </p>
      )}

      <div className="flex gap-3">
        <button type="submit" disabled={save.isPending} className={primaryButtonClass}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
        <Link to="/admin/users" className={secondaryButtonClass}>
          {t('common.cancel')}
        </Link>
      </div>
    </form>
  );
}
