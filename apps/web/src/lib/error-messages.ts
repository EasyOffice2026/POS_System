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
  ITEM_NOT_FOUND: 'validation.ITEM_NOT_FOUND',
  NAME_REQUIRED: 'validation.NAME_REQUIRED',
  NAME_TOO_LONG: 'validation.NAME_TOO_LONG',
  LOGO_URL_INVALID: 'validation.LOGO_URL_INVALID',
  ADDRESS_TOO_LONG: 'validation.ADDRESS_TOO_LONG',
  TIMEZONE_INVALID: 'validation.TIMEZONE_INVALID',
  HOURS_TIME_FORMAT: 'validation.HOURS_TIME_FORMAT',
  HOURS_RANGE_EMPTY: 'validation.HOURS_RANGE_EMPTY',
  HOURS_RANGES_REQUIRED: 'validation.HOURS_RANGES_REQUIRED',
  HOURS_TOO_MANY_RANGES: 'validation.HOURS_TOO_MANY_RANGES',
  HOURS_OVERLAP: 'validation.HOURS_OVERLAP',
  PRINTER_NAME_REQUIRED: 'validation.PRINTER_NAME_REQUIRED',
  PRINTER_NAME_TOO_LONG: 'validation.PRINTER_NAME_TOO_LONG',
  PRINTER_NAME_TAKEN: 'validation.PRINTER_NAME_TAKEN',
  PRINTER_HOST_INVALID: 'validation.PRINTER_HOST_INVALID',
  PRINTER_PORT_INVALID: 'validation.PRINTER_PORT_INVALID',
  PRINTERS_TOO_MANY: 'validation.PRINTERS_TOO_MANY',
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

// Sorts an error into problems on single fields and a problem with the form as a whole. A form
// about something other than a person can name its own code for a 404, so the sentence fits.
export function problemsFrom(error: unknown, options: { notFound?: string } = {}): FormProblems {
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
      return { fields: {}, form: error.code };
    case 'NOT_FOUND':
      return { fields: {}, form: options.notFound ?? error.code };
    default:
      return { fields: {}, form: 'saveError' };
  }
}

// The problems that a shared schema found, as the same kind of map the API's answer gives: the
// path of the field joined with dots (name.en, monday.ranges.0.close) and the code. The first
// problem of a field is the one that is kept.
export function fieldsFromIssues(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.map(String).join('.');
    fields[path] ??= issue.message;
  }
  return fields;
}

// Picks the problems under a path and writes their paths from there: with the prefix
// config.printers, the problem config.printers.0.name becomes 0.name.
export function fieldsUnder(
  fields: Record<string, string>,
  prefix: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [path, code] of Object.entries(fields)) {
    if (path === prefix) result[''] = code;
    else if (path.startsWith(`${prefix}.`)) result[path.slice(prefix.length + 1)] = code;
  }
  return result;
}
