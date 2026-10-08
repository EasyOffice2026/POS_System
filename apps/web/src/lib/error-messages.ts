import type { TFunction } from 'i18next';
import { z } from 'zod';
import { ApiError } from './api';

// Every problem a form can show is a code, so the sentence follows the language if it is switched
// after the problem appears. These codes come from the shared rules and from the API.
const messageKeys = {
  required: 'validation.required',
  emailInvalid: 'validation.emailInvalid',
  invalid: 'validation.invalid',
  PIN_FORMAT: 'validation.PIN_FORMAT',
  PIN_REPEATED: 'validation.PIN_REPEATED',
  PIN_SEQUENCE: 'validation.PIN_SEQUENCE',
  PASSWORD_TOO_SHORT: 'validation.PASSWORD_TOO_SHORT',
  PASSWORD_TOO_LONG: 'validation.PASSWORD_TOO_LONG',
  EMAIL_OR_STAFF_CODE_REQUIRED: 'validation.EMAIL_OR_STAFF_CODE_REQUIRED',
  PASSWORD_NEEDS_EMAIL: 'validation.PASSWORD_NEEDS_EMAIL',
  PIN_NEEDS_STAFF_CODE: 'validation.PIN_NEEDS_STAFF_CODE',
  PIN_ONLY_FOR_BRANCH_ROLES: 'validation.PIN_ONLY_FOR_BRANCH_ROLES',
  STAFF_CODE_NEEDS_BRAND: 'validation.STAFF_CODE_NEEDS_BRAND',
  BRAND_REQUIRED: 'validation.BRAND_REQUIRED',
  BRAND_NOT_FOUND: 'validation.BRAND_NOT_FOUND',
  BRAND_NOT_ALLOWED_FOR_GROUP_ROLE: 'validation.BRAND_NOT_ALLOWED_FOR_GROUP_ROLE',
  BRANCH_REQUIRED: 'validation.BRANCH_REQUIRED',
  BRANCH_NOT_FOUND: 'validation.BRANCH_NOT_FOUND',
  BRANCHES_NOT_ALLOWED_FOR_ROLE: 'validation.BRANCHES_NOT_ALLOWED_FOR_ROLE',
  ROLE_NOT_FOUND: 'validation.ROLE_NOT_FOUND',
  EMAIL_TAKEN: 'validation.EMAIL_TAKEN',
  STAFF_CODE_TAKEN: 'validation.STAFF_CODE_TAKEN',
  FORBIDDEN: 'validation.FORBIDDEN',
  NOT_FOUND: 'validation.NOT_FOUND',
  saveError: 'common.saveError',
  network: 'auth.errors.network',
} as const;

type MessageKey = (typeof messageKeys)[keyof typeof messageKeys];

export function messageFor(code: string, t: TFunction): string {
  const key = (messageKeys as Record<string, MessageKey | undefined>)[code];
  return t(key ?? 'validation.invalid');
}

const detailsSchema = z.array(z.object({ path: z.string(), message: z.string() }));

// What went wrong on a form: codes for single fields, and one for the whole form.
export interface FormProblems {
  fields: Record<string, string>;
  form: string | null;
}

// Sorts an error into problems on single fields and a problem with the form as a whole.
export function problemsFrom(error: unknown): FormProblems {
  if (!(error instanceof ApiError)) {
    const unreachable =
      error instanceof TypeError ||
      (error instanceof DOMException && error.name === 'TimeoutError');
    return { fields: {}, form: unreachable ? 'network' : 'saveError' };
  }

  switch (error.code) {
    case 'VALIDATION_ERROR': {
      const details = detailsSchema.safeParse(error.details);
      if (!details.success) return { fields: {}, form: 'invalid' };

      const fields: Record<string, string> = {};
      let form: string | null = null;
      for (const { path, message } of details.data) {
        if (path) fields[path] = message;
        else form = message;
      }
      return { fields, form };
    }
    case 'EMAIL_TAKEN':
      return { fields: { email: 'EMAIL_TAKEN' }, form: null };
    case 'STAFF_CODE_TAKEN':
      return { fields: { staffCode: 'STAFF_CODE_TAKEN' }, form: null };
    case 'FORBIDDEN':
    case 'NOT_FOUND':
      return { fields: {}, form: error.code };
    default:
      return { fields: {}, form: 'saveError' };
  }
}
