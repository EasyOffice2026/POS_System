import { z } from 'zod';
import { ApiError } from '../../lib/api';

const detailsSchema = z.array(z.object({ path: z.string(), message: z.string() }));

// The codes the order screen can explain. Anything else is "something went wrong".
const knownCodes = [
  'ITEM_NOT_AVAILABLE',
  'ITEM_NOT_AVAILABLE_NOW',
  'MODIFIER_NOT_AVAILABLE',
  'MODIFIER_CHOICE_MISSING',
  'TOO_MANY_MODIFIERS',
  'COMBO_NOT_AVAILABLE',
  'SLOT_NOT_FOUND',
  'SLOT_CHOICE_MISSING',
  'OPTION_NOT_AVAILABLE',
  'ORDER_NOT_OPEN',
  'LINE_ALREADY_SENT',
  'LINE_VOIDED',
  'LINE_NOT_SENT',
  'NOTHING_TO_SEND',
  'ORDER_FULL',
  'BRANCH_INACTIVE',
  'NOT_FOUND',
  'APPROVAL_INVALID',
  'APPROVAL_LOCKED',
  'APPROVAL_NOT_ALLOWED',
  'DISCOUNT_VALUE_INVALID',
  'REASON_REQUIRED',
  'REASON_TOO_LONG',
  'PAYMENT_TOTAL_MISMATCH',
  'PAYMENT_TENDERED_SHORT',
  'PAYMENT_TOO_MANY_CASH',
  'PAYMENT_AMOUNT_INVALID',
  'PAYMENT_TENDERS_INVALID',
  'PAYMENT_ID_TAKEN',
  'ORDER_EMPTY',
  'network',
] as const;

export type Problem = (typeof knownCodes)[number] | 'unknown';

const known = new Set<string>(knownCodes);
const isKnown = (code: string | undefined): code is Problem =>
  code !== undefined && known.has(code);

// What went wrong, as a code: the first problem the API named, or the code of the answer.
export function problemOf(error: unknown): Problem {
  if (!(error instanceof ApiError)) {
    const unreachable =
      error instanceof TypeError ||
      (error instanceof DOMException && error.name === 'TimeoutError');
    return unreachable ? 'network' : 'unknown';
  }
  if (error.code === 'VALIDATION_ERROR') {
    const details = detailsSchema.safeParse(error.details);
    const first = details.success ? details.data[0]?.message : undefined;
    return isKnown(first) ? first : 'unknown';
  }
  return isKnown(error.code) ? error.code : 'unknown';
}

// The API asks for a manager's staff code and PIN (spec 005, rule 8).
export const needsApproval = (error: unknown) =>
  error instanceof ApiError &&
  error.code === 'VALIDATION_ERROR' &&
  detailsSchema
    .safeParse(error.details)
    .data?.some(
      (detail) => detail.path === 'approval' && detail.message === 'APPROVAL_REQUIRED',
    ) === true;

// A problem that means the menu on the screen is out of date, so it is loaded again.
export const menuIsStale = (code: string) =>
  [
    'ITEM_NOT_AVAILABLE',
    'MODIFIER_NOT_AVAILABLE',
    'COMBO_NOT_AVAILABLE',
    'SLOT_NOT_FOUND',
    'OPTION_NOT_AVAILABLE',
    'MODIFIER_CHOICE_MISSING',
    'TOO_MANY_MODIFIERS',
    'SLOT_CHOICE_MISSING',
  ].includes(code);
