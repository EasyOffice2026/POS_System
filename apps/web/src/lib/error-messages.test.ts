import i18n from 'i18next';
import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { messageFor, problemsFrom } from './error-messages';

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
    ];

    for (const code of codes) {
      expect(messageFor(code, t), code).not.toBe('Check the highlighted fields.');
    }
  });
});
