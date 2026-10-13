import { describe, expect, it } from 'vitest';
import { formatDateTime } from '../i18n/format';
import { queryString } from './query-string';

describe('queryString', () => {
  it('joins the values that are set', () => {
    expect(queryString({ role: 'cashier', limit: 25 })).toBe('?role=cashier&limit=25');
  });

  it('leaves out empty and missing values', () => {
    expect(queryString({ q: '', role: undefined, limit: 25 })).toBe('?limit=25');
  });

  it('is empty when nothing is set', () => {
    expect(queryString({})).toBe('');
    expect(queryString({ q: undefined })).toBe('');
  });

  it('writes special characters so they survive the trip', () => {
    expect(queryString({ q: 'a&b c' })).toBe('?q=a%26b+c');
  });

  it('keeps a zero', () => {
    expect(queryString({ page: 0 })).toBe('?page=0');
  });
});

describe('formatDateTime', () => {
  const moment = '2026-10-08T09:30:00.000Z';

  it('writes English dates for English', () => {
    const text = formatDateTime(moment, 'en');

    expect(text).toMatch(/2026/);
    expect(text).toMatch(/Oct/);
  });

  it('writes Arabic dates with Western digits and the Gregorian calendar', () => {
    const text = formatDateTime(moment, 'ar');

    expect(text).toMatch(/2026/);
    expect(text).not.toMatch(/[٠-٩]/);
    // The default Arabic calendar would give a Hijri year such as 1448.
    expect(text).not.toMatch(/144\d/);
  });

  it('gives the same instant in both languages', () => {
    const digits = (text: string) => text.replace(/\D/g, '');

    expect(digits(formatDateTime(moment, 'ar'))).toContain('2026');
    expect(digits(formatDateTime(moment, 'en'))).toContain('2026');
  });
});
