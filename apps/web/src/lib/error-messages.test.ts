import i18n from 'i18next';
import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { fieldsFromIssues, fieldsUnder, messageFor, problemsFrom } from './error-messages';

describe('problemsFrom', () => {
  it('puts each validation problem on the field it names', () => {
    const error = new ApiError(400, 'VALIDATION_ERROR', 'x', [
      { path: 'pin', message: 'PIN_SEQUENCE' },
      { path: 'branchIds', message: 'BRANCH_REQUIRED' },
    ]);

    expect(problemsFrom(error)).toEqual({
      fields: { pin: 'PIN_SEQUENCE', branchIds: 'BRANCH_REQUIRED' },
      form: null,
    });
  });

  it('keeps a problem with no field for the whole form', () => {
    const error = new ApiError(400, 'VALIDATION_ERROR', 'x', [
      { path: '', message: 'NOTHING_TO_UPDATE' },
    ]);

    expect(problemsFrom(error)).toEqual({ fields: {}, form: 'NOTHING_TO_UPDATE' });
  });

  it('falls back to a general message when the details are not in the expected shape', () => {
    expect(problemsFrom(new ApiError(400, 'VALIDATION_ERROR', 'x', 'nonsense'))).toEqual({
      fields: {},
      form: 'invalid',
    });
    expect(problemsFrom(new ApiError(400, 'VALIDATION_ERROR', 'x'))).toEqual({
      fields: {},
      form: 'invalid',
    });
  });

  it('turns a taken email or staff code into a problem on that field', () => {
    expect(problemsFrom(new ApiError(409, 'EMAIL_TAKEN', 'x'))).toEqual({
      fields: { email: 'EMAIL_TAKEN' },
      form: null,
    });
    expect(problemsFrom(new ApiError(409, 'STAFF_CODE_TAKEN', 'x'))).toEqual({
      fields: { staffCode: 'STAFF_CODE_TAKEN' },
      form: null,
    });
  });

  it('keeps permission and not-found answers for the whole form', () => {
    expect(problemsFrom(new ApiError(403, 'FORBIDDEN', 'x')).form).toBe('FORBIDDEN');
    expect(problemsFrom(new ApiError(404, 'NOT_FOUND', 'x')).form).toBe('NOT_FOUND');
  });

  it('keeps a limit of the menu for the whole form', () => {
    expect(problemsFrom(new ApiError(409, 'CATEGORY_LIMIT', 'x'))).toEqual({
      fields: {},
      form: 'CATEGORY_LIMIT',
    });
    expect(problemsFrom(new ApiError(409, 'MODIFIER_LIMIT', 'x')).form).toBe('MODIFIER_LIMIT');
  });

  it('lets a form choose the sentence for a 404, so it does not talk about a person', () => {
    const notFound = new ApiError(404, 'NOT_FOUND', 'x');

    expect(problemsFrom(notFound, { notFound: 'ITEM_NOT_FOUND' }).form).toBe('ITEM_NOT_FOUND');
    expect(problemsFrom(notFound).form).toBe('NOT_FOUND');
    expect(
      problemsFrom(new ApiError(403, 'FORBIDDEN', 'x'), { notFound: 'ITEM_NOT_FOUND' }).form,
    ).toBe('FORBIDDEN');
  });

  it('calls any other answer a failed save', () => {
    expect(problemsFrom(new ApiError(500, 'INTERNAL_ERROR', 'x')).form).toBe('saveError');
  });

  it('tells apart a server that cannot be reached', () => {
    expect(problemsFrom(new TypeError('Failed to fetch')).form).toBe('network');
    expect(problemsFrom(new DOMException('slow', 'TimeoutError')).form).toBe('network');
    expect(problemsFrom(new Error('odd')).form).toBe('saveError');
  });
});

describe('messageFor', () => {
  const t = i18n.t.bind(i18n);

  it('turns a code into a sentence in the current language', async () => {
    expect(messageFor('PIN_REPEATED', t)).toBe('A PIN cannot be one digit repeated.');

    await i18n.changeLanguage('ar');

    expect(messageFor('PIN_REPEATED', t)).toBe('لا يجوز أن يكون الرقم السري رقماً واحداً مكرراً.');
  });

  it('uses a general sentence for a code it does not know', () => {
    expect(messageFor('SOMETHING_NEW', t)).toBe('Check the highlighted fields.');
  });

  it('has a sentence for every problem the shared rules and the API can report', () => {
    const codes = [
      'required',
      'emailInvalid',
      'PIN_FORMAT',
      'PIN_REPEATED',
      'PIN_SEQUENCE',
      'PASSWORD_TOO_SHORT',
      'PASSWORD_TOO_LONG',
      'EMAIL_OR_STAFF_CODE_REQUIRED',
      'PASSWORD_NEEDS_EMAIL',
      'PIN_NEEDS_STAFF_CODE',
      'PIN_ONLY_FOR_BRANCH_ROLES',
      'STAFF_CODE_NEEDS_BRAND',
      'BRAND_REQUIRED',
      'BRAND_NOT_FOUND',
      'BRAND_NOT_ALLOWED_FOR_GROUP_ROLE',
      'BRANCH_REQUIRED',
      'BRANCH_NOT_FOUND',
      'BRANCHES_NOT_ALLOWED_FOR_ROLE',
      'ROLE_NOT_FOUND',
      'EMAIL_TAKEN',
      'STAFF_CODE_TAKEN',
      'FORBIDDEN',
      'NOT_FOUND',
      'saveError',
      'network',
      'ITEM_NOT_FOUND',
      'NAME_REQUIRED',
      'NAME_TOO_LONG',
      'LOGO_URL_INVALID',
      'ADDRESS_TOO_LONG',
      'TIMEZONE_INVALID',
      'HOURS_TIME_FORMAT',
      'HOURS_RANGE_EMPTY',
      'HOURS_RANGES_REQUIRED',
      'HOURS_TOO_MANY_RANGES',
      'HOURS_OVERLAP',
      'PRINTER_NAME_REQUIRED',
      'PRINTER_NAME_TOO_LONG',
      'PRINTER_NAME_TAKEN',
      'PRINTER_HOST_INVALID',
      'PRINTER_PORT_INVALID',
      'PRINTERS_TOO_MANY',
      'PRICE_INVALID',
      'IMAGE_URL_INVALID',
      'DESCRIPTION_REQUIRED',
      'DESCRIPTION_TOO_LONG',
      'CATEGORY_NOT_FOUND',
      'CATEGORY_LIMIT',
      'ORDER_MISMATCH',
      'MODIFIER_LIMIT',
      'MIN_SELECT_INVALID',
      'MAX_SELECT_INVALID',
      'SELECT_RANGE_INVALID',
      'SLOT_NEEDS_OPTION',
      'COMBO_NEEDS_SLOT',
      'TOO_MANY_SLOTS',
      'TOO_MANY_OPTIONS',
      'OPTION_DUPLICATE',
    ];

    for (const code of codes) {
      expect(messageFor(code, t), code).not.toBe('Check the highlighted fields.');
    }
  });
});

describe('fieldsFromIssues', () => {
  it('writes the path of each problem with dots, and keeps the first problem of a field', () => {
    const fields = fieldsFromIssues([
      { path: ['name', 'en'], message: 'NAME_REQUIRED' },
      { path: ['name', 'en'], message: 'NAME_TOO_LONG' },
      { path: ['monday', 'ranges', 0, 'close'], message: 'HOURS_RANGE_EMPTY' },
      { path: [], message: 'PRINTERS_TOO_MANY' },
    ]);

    expect(fields).toEqual({
      'name.en': 'NAME_REQUIRED',
      'monday.ranges.0.close': 'HOURS_RANGE_EMPTY',
      '': 'PRINTERS_TOO_MANY',
    });
  });

  it('is empty when there is nothing wrong', () => {
    expect(fieldsFromIssues([])).toEqual({});
  });
});

describe('fieldsUnder', () => {
  const fields = {
    'config.printers.0.name': 'PRINTER_NAME_REQUIRED',
    'config.printers.1.host': 'PRINTER_HOST_INVALID',
    'config.printers': 'PRINTERS_TOO_MANY',
    'config.openingHours.monday': 'HOURS_OVERLAP',
    name: 'NAME_REQUIRED',
  };

  it('keeps the problems under a path and writes their paths from there', () => {
    expect(fieldsUnder(fields, 'config.printers')).toEqual({
      '0.name': 'PRINTER_NAME_REQUIRED',
      '1.host': 'PRINTER_HOST_INVALID',
      '': 'PRINTERS_TOO_MANY',
    });
    expect(fieldsUnder(fields, 'config.openingHours')).toEqual({ monday: 'HOURS_OVERLAP' });
  });

  it('does not take a path that only starts with the same letters', () => {
    expect(fieldsUnder({ 'config.printersX.0': 'A' }, 'config.printers')).toEqual({});
  });
});
