import { z } from 'zod';

// Prices have 3 decimal places and travel as text ("12.500"), never as floating-point numbers, so
// no digit is ever lost. The database holds numeric(10,3): up to 7 digits before the point.
// The currency is SAR for now.

export const CURRENCY = 'SAR';

const unsigned = /^\d{1,7}(\.\d{1,3})?$/;
const signed = /^-?\d{1,7}(\.\d{1,3})?$/;

// Writes a price with exactly 3 decimals: "12" and "12.5" become "12.500", "007.250" becomes
// "7.250", and "-0" becomes "0.000". The text must already be a price (see priceSchema).
export function formatMoney(text: string): string {
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const result = `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(3, '0')}`;
  return negative && /[1-9]/.test(result) ? `-${result}` : result;
}

// A price that is not below zero, for example the price of an item or of a combo.
export const priceSchema = z
  .string({ error: 'PRICE_INVALID' })
  .trim()
  .regex(unsigned, 'PRICE_INVALID')
  .transform(formatMoney);

// A change to a price, which may be below zero, for example a modifier that takes 2.000 off.
export const priceChangeSchema = z
  .string({ error: 'PRICE_INVALID' })
  .trim()
  .regex(signed, 'PRICE_INVALID')
  .transform(formatMoney);

const moneyText = /^-?\d+(\.\d{1,3})?$/;

// Money as a whole number of thousandths (12.500 is 12500), so sums have no rounding errors. A
// whole order (200 lines of up to 9,999,999.999 times 99) still fits exactly in a number.
export function toMils(text: string): number {
  if (!moneyText.test(text)) throw new RangeError(`"${text}" is not an amount of money.`);
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const mils = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  return negative ? -mils : mils;
}

// Thousandths back to text with 3 decimals: 12500 becomes "12.500".
export function fromMils(mils: number): string {
  if (!Number.isSafeInteger(mils)) {
    throw new RangeError(`${mils} is not a whole number of thousandths.`);
  }
  const amount = Math.abs(mils);
  const text = `${Math.floor(amount / 1000)}.${String(amount % 1000).padStart(3, '0')}`;
  return mils < 0 ? `-${text}` : text;
}

// A percentage of an amount, rounded to the nearest thousandth (a half goes up). The percentage
// has up to 2 decimals ("12.5" or "12.50"). Worked out with whole numbers only.
export function percentOfMils(mils: number, percent: string): number {
  const [whole = '0', fraction = ''] = percent.split('.');
  const hundredths = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return Number((BigInt(mils) * hundredths + 5000n) / 10000n);
}
