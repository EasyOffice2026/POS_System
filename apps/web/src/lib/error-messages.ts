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
  PASSWORD_WRONG: 'validation.PASSWORD_WRONG',
  PASSWORD_SAME: 'validation.PASSWORD_SAME',
  PASSWORD_MISMATCH: 'validation.PASSWORD_MISMATCH',
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
  PRICE_INVALID: 'validation.PRICE_INVALID',
  IMAGE_URL_INVALID: 'validation.IMAGE_URL_INVALID',
  DESCRIPTION_REQUIRED: 'validation.DESCRIPTION_REQUIRED',
  DESCRIPTION_TOO_LONG: 'validation.DESCRIPTION_TOO_LONG',
  CATEGORY_REQUIRED: 'validation.CATEGORY_REQUIRED',
  ITEM_REQUIRED: 'validation.ITEM_REQUIRED',
  CATEGORY_NOT_FOUND: 'validation.CATEGORY_NOT_FOUND',
  CATEGORY_LIMIT: 'validation.CATEGORY_LIMIT',
  ORDER_MISMATCH: 'validation.ORDER_MISMATCH',
  MODIFIER_LIMIT: 'validation.MODIFIER_LIMIT',
  MIN_SELECT_INVALID: 'validation.MIN_SELECT_INVALID',
  MAX_SELECT_INVALID: 'validation.MAX_SELECT_INVALID',
  SELECT_RANGE_INVALID: 'validation.SELECT_RANGE_INVALID',
  SLOT_NEEDS_OPTION: 'validation.SLOT_NEEDS_OPTION',
  COMBO_NEEDS_SLOT: 'validation.COMBO_NEEDS_SLOT',
  TOO_MANY_SLOTS: 'validation.TOO_MANY_SLOTS',
  TOO_MANY_OPTIONS: 'validation.TOO_MANY_OPTIONS',
  OPTION_DUPLICATE: 'validation.OPTION_DUPLICATE',
  STATION_NOT_FOUND: 'validation.STATION_NOT_FOUND',
  PAYMENT_METHOD_INVALID: 'validation.PAYMENT_METHOD_INVALID',
  PAYMENT_METHOD_KEY_INVALID: 'validation.PAYMENT_METHOD_KEY_INVALID',
  PAYMENT_METHOD_KEY_TAKEN: 'validation.PAYMENT_METHOD_KEY_TAKEN',
  PAYMENT_METHODS_TOO_MANY: 'validation.PAYMENT_METHODS_TOO_MANY',
  DISCOUNT_PRESET_INVALID: 'validation.DISCOUNT_PRESET_INVALID',
  DISCOUNT_PRESETS_TOO_MANY: 'validation.DISCOUNT_PRESETS_TOO_MANY',
  PERCENT_INVALID: 'validation.PERCENT_INVALID',
  VOID_RULE_INVALID: 'validation.VOID_RULE_INVALID',
  TICKET_DONE_BY_INVALID: 'validation.TICKET_DONE_BY_INVALID',
  KITCHEN_STATIONS_TOO_MANY: 'validation.KITCHEN_STATIONS_TOO_MANY',
  CASH_INVALID: 'validation.CASH_INVALID',
  SHIFT_ALREADY_OPEN: 'validation.SHIFT_ALREADY_OPEN',
  SHIFT_NOT_OPEN: 'validation.SHIFT_NOT_OPEN',
  SHIFT_REQUIRED: 'validation.SHIFT_REQUIRED',
  REFUND_AMOUNT_INVALID: 'validation.REFUND_AMOUNT_INVALID',
  REFUND_TOO_MUCH: 'validation.REFUND_TOO_MUCH',
  REFUND_METHOD_INVALID: 'validation.REFUND_METHOD_INVALID',
  UNIT_INVALID: 'validation.UNIT_INVALID',
  UNIT_LOCKED: 'validation.UNIT_LOCKED',
  QUANTITY_INVALID: 'validation.QUANTITY_INVALID',
  NOTE_REQUIRED: 'validation.NOTE_REQUIRED',
  STOCK_NEGATIVE: 'validation.STOCK_NEGATIVE',
  INGREDIENT_NOT_FOUND: 'validation.INGREDIENT_NOT_FOUND',
  INGREDIENT_REQUIRED: 'validation.INGREDIENT_REQUIRED',
  MOVEMENT_KIND_INVALID: 'validation.MOVEMENT_KIND_INVALID',
  INGREDIENT_DUPLICATE: 'validation.INGREDIENT_DUPLICATE',
  RECIPE_TOO_LONG: 'validation.RECIPE_TOO_LONG',
  TRANSFER_SAME_BRANCH: 'validation.TRANSFER_SAME_BRANCH',
  TRANSFER_EMPTY: 'validation.TRANSFER_EMPTY',
  TRANSFER_TOO_LONG: 'validation.TRANSFER_TOO_LONG',
  TRANSFER_NOT_SENT: 'validation.TRANSFER_NOT_SENT',
  COUNT_ALREADY_OPEN: 'validation.COUNT_ALREADY_OPEN',
  COUNT_NOT_OPEN: 'validation.COUNT_NOT_OPEN',
  COUNT_EMPTY: 'validation.COUNT_EMPTY',
  COUNT_TOO_LONG: 'validation.COUNT_TOO_LONG',
  COUNT_LINES_REQUIRED: 'validation.COUNT_LINES_REQUIRED',
  SUPPLIER_NAME_REQUIRED: 'validation.SUPPLIER_NAME_REQUIRED',
  SUPPLIER_NAME_TAKEN: 'validation.SUPPLIER_NAME_TAKEN',
  SUPPLIER_NOT_FOUND: 'validation.SUPPLIER_NOT_FOUND',
  PHONE_INVALID: 'validation.PHONE_INVALID',
  EMAIL_INVALID: 'validation.EMAIL_INVALID',
  PAYMENT_DAYS_INVALID: 'validation.PAYMENT_DAYS_INVALID',
  PRICE_LIST_TOO_LONG: 'validation.PRICE_LIST_TOO_LONG',
  NOTE_TOO_LONG: 'validation.NOTE_TOO_LONG',
  PRICE_REQUIRED: 'validation.PRICE_REQUIRED',
  ORDER_EMPTY: 'validation.ORDER_EMPTY',
  ORDER_TOO_LONG: 'validation.ORDER_TOO_LONG',
  ORDER_NOT_DRAFT: 'validation.ORDER_NOT_DRAFT',
  ORDER_CLOSED: 'validation.ORDER_CLOSED',
  DATE_INVALID: 'validation.DATE_INVALID',
  ORDER_NOT_SENT: 'validation.ORDER_NOT_SENT',
  RECEIPT_EMPTY: 'validation.RECEIPT_EMPTY',
  INVOICE_NUMBER_INVALID: 'validation.INVOICE_NUMBER_INVALID',
  RANGE_TOO_LONG: 'validation.RANGE_TOO_LONG',
  RANGE_INVALID: 'validation.RANGE_INVALID',
  PROMO_CODE_INVALID: 'validation.PROMO_CODE_INVALID',
  PROMO_CODE_TAKEN: 'validation.PROMO_CODE_TAKEN',
  TIME_INVALID: 'validation.TIME_INVALID',
  DAYS_INVALID: 'validation.DAYS_INVALID',
  POINTS_RATE_INVALID: 'validation.POINTS_RATE_INVALID',
  POINTS_MIN_INVALID: 'validation.POINTS_MIN_INVALID',
  POINTS_INVALID: 'validation.POINTS_INVALID',
  POINTS_TOO_FEW: 'validation.POINTS_TOO_FEW',
  POINTS_NOT_ENOUGH: 'validation.POINTS_NOT_ENOUGH',
  POINTS_TOO_MANY: 'validation.POINTS_TOO_MANY',
  LOYALTY_OFF: 'validation.LOYALTY_OFF',
  CUSTOMER_REQUIRED: 'validation.CUSTOMER_REQUIRED',
  PHONE_TAKEN: 'validation.PHONE_TAKEN',
  TABLE_OVERLAP: 'validation.TABLE_OVERLAP',
  TABLE_OUTSIDE: 'validation.TABLE_OUTSIDE',
  TABLE_NAME_REQUIRED: 'validation.TABLE_NAME_REQUIRED',
  TABLE_NAME_TOO_LONG: 'validation.TABLE_NAME_TOO_LONG',
  TABLE_NAME_TAKEN: 'validation.TABLE_NAME_TAKEN',
  AREA_REQUIRED: 'validation.AREA_REQUIRED',
  AREA_TOO_LONG: 'validation.AREA_TOO_LONG',
  SEATS_INVALID: 'validation.SEATS_INVALID',
  TABLE_SIZE_INVALID: 'validation.TABLE_SIZE_INVALID',
  TABLE_SHAPE_INVALID: 'validation.TABLE_SHAPE_INVALID',
  TABLE_REPEATED: 'validation.TABLE_REPEATED',
  TABLES_TOO_MANY: 'validation.TABLES_TOO_MANY',
  TABLE_NOT_FOUND: 'validation.TABLE_NOT_FOUND',
  TABLE_IN_USE: 'validation.TABLE_IN_USE',
  TABLE_TAKEN: 'validation.TABLE_TAKEN',
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
    // A limit of the menu is reached: the answer says which one.
    case 'CATEGORY_LIMIT':
    case 'MODIFIER_LIMIT':
    case 'SHIFT_ALREADY_OPEN':
    case 'SHIFT_NOT_OPEN':
    case 'SHIFT_REQUIRED':
    case 'TRANSFER_NOT_SENT':
    case 'COUNT_ALREADY_OPEN':
    case 'COUNT_NOT_OPEN':
    case 'COUNT_EMPTY':
    case 'ORDER_NOT_DRAFT':
    case 'ORDER_CLOSED':
    case 'ORDER_NOT_SENT':
    case 'LOYALTY_OFF':
    case 'TABLE_IN_USE':
    case 'TABLE_TAKEN':
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
