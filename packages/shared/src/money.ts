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
