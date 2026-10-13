import { describe, expect, it } from 'vitest';
import { formatMoney, priceChangeSchema, priceSchema } from './money';

describe('priceSchema', () => {
  it.each([
    ['12.500', '12.500'],
    ['12', '12.000'],
    ['12.5', '12.500'],
    ['12.25', '12.250'],
    ['0', '0.000'],
    ['0.001', '0.001'],
    ['9999999.999', '9999999.999'],
    ['007.250', '7.250'],
    [' 12.5 ', '12.500'],
  ])('reads %j as %s', (text, expected) => {
    expect(priceSchema.parse(text)).toBe(expected);
  });

  it.each([
    '',
    ' ',
    '-1',
    '+1',
    '1.2345',
    '12.',
    '.5',
    '1e3',
    'abc',
    '10000000',
    '1,5',
    '12 .5',
    '١٢',
    '12.5.1',
  ])('refuses %j', (text) => {
    expect(priceSchema.safeParse(text).error?.issues[0]?.message).toBe('PRICE_INVALID');
  });

  it('refuses a number, because prices travel as text', () => {
    expect(priceSchema.safeParse(12.5).error?.issues[0]?.message).toBe('PRICE_INVALID');
    expect(priceChangeSchema.safeParse(null).error?.issues[0]?.message).toBe('PRICE_INVALID');
  });

  it('is the same when it is read again', () => {
    expect(priceSchema.parse(priceSchema.parse('7.5'))).toBe('7.500');
  });
});

describe('priceChangeSchema', () => {
  it.each([
    ['2', '2.000'],
    ['-2', '-2.000'],
    ['-2.5', '-2.500'],
    ['0', '0.000'],
    ['-0', '0.000'],
    ['-0.000', '0.000'],
    ['-0.001', '-0.001'],
    ['-9999999.999', '-9999999.999'],
  ])('reads %j as %s', (text, expected) => {
    expect(priceChangeSchema.parse(text)).toBe(expected);
  });

  it.each(['+2.000', '--2', '-', '-.5', '2-', '-1.2345', '-10000000'])('refuses %j', (text) => {
    expect(priceChangeSchema.safeParse(text).error?.issues[0]?.message).toBe('PRICE_INVALID');
  });
});

describe('formatMoney', () => {
  it('writes exactly 3 decimals and drops leading zeros', () => {
    expect(formatMoney('5')).toBe('5.000');
    expect(formatMoney('0005.1')).toBe('5.100');
    expect(formatMoney('0')).toBe('0.000');
    expect(formatMoney('-0.0')).toBe('0.000');
    expect(formatMoney('-7')).toBe('-7.000');
  });
});
