import { z } from 'zod';
import { cursorQuerySchema } from './pagination';
import { normalizeSearchText, searchQuerySchema } from './search';
import type { LoyaltySettings } from './settings';

// The customers of a brand and their loyalty points. See docs/specs/022-loyalty.md.

// A phone as it is kept: "+" and 8 to 15 digits. Spaces, dashes and brackets are dropped, "00" at
// the start is "+", and eight digits alone are a Kuwaiti number (rule 1). Null when it is not one.
export function normalizePhone(text: string): string | null {
  let digits = text.trim().replace(/[\s\-().]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (/^\d{8}$/.test(digits)) digits = `+965${digits}`;
  if (!digits.startsWith('+')) digits = `+${digits}`;
  return /^\+\d{8,15}$/.test(digits) ? digits : null;
}

export const customerPhoneSchema = z.string({ error: 'PHONE_INVALID' }).transform((text, ctx) => {
  const phone = normalizePhone(text);
  if (phone === null) {
    ctx.addIssue({ code: 'custom', message: 'PHONE_INVALID' });
    return z.NEVER;
  }
  return phone;
});

const optionalText = (max: number, code: string) =>
  z
    .string({ error: code })
    .trim()
    .max(max, code)
    .transform((text) => (text === '' ? null : text));

// ---------------------------------------------------------------------------------------------
// What the API answers

export const customerSchema = z.object({
  id: z.uuid(),
  brandId: z.uuid(),
  phone: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  notes: z.string().nullable(),
  points: z.number().int(),
  visits: z.number().int(),
  totalSpent: z.string(),
  lastVisitAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type Customer = z.infer<typeof customerSchema>;

export const loyaltyEntryKinds = ['earn', 'redeem', 'adjust'] as const;
export const loyaltyEntrySchema = z.object({
  id: z.uuid(),
  kind: z.enum(loyaltyEntryKinds),
  // Negative when points go.
  points: z.number().int(),
  balanceAfter: z.number().int(),
  orderId: z.uuid().nullable(),
  // The order's number, for an entry about an order.
  orderNumber: z.number().int().nullable(),
  note: z.string().nullable(),
  byName: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type LoyaltyEntry = z.infer<typeof loyaltyEntrySchema>;

export const customerDetailSchema = customerSchema.extend({
  entries: z.array(loyaltyEntrySchema),
});
export type CustomerDetail = z.infer<typeof customerDetailSchema>;

// The customer as an order shows it.
export const orderCustomerSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  phone: z.string(),
  points: z.number().int(),
});
export type OrderCustomer = z.infer<typeof orderCustomerSchema>;

// ---------------------------------------------------------------------------------------------
// Requests

export const customerListQuerySchema = cursorQuerySchema.extend({
  // A group admin looks at one brand's customers at a time.
  brandId: z.uuid().optional(),
  q: searchQuerySchema.optional(),
});
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

export const customerLookupQuerySchema = z.object({ phone: customerPhoneSchema });

export const updateCustomerRequestSchema = z
  .strictObject({
    name: optionalText(100, 'NAME_TOO_LONG').optional(),
    email: z
      .string({ error: 'EMAIL_INVALID' })
      .trim()
      .max(200, 'EMAIL_INVALID')
      .refine((text) => text === '' || z.email().safeParse(text).success, 'EMAIL_INVALID')
      .transform((text) => (text === '' ? null : text.toLowerCase()))
      .optional(),
    notes: optionalText(500, 'NOTE_TOO_LONG').optional(),
  })
  .refine((request) => Object.keys(request).length > 0, { message: 'NOTHING_TO_UPDATE' });
export type UpdateCustomerRequest = z.infer<typeof updateCustomerRequestSchema>;

export const adjustPointsRequestSchema = z.strictObject({
  points: z
    .number({ error: 'POINTS_INVALID' })
    .int('POINTS_INVALID')
    .refine((points) => points !== 0 && Math.abs(points) <= 1_000_000, 'POINTS_INVALID'),
  reason: z
    .string({ error: 'NOTE_REQUIRED' })
    .trim()
    .min(1, 'NOTE_REQUIRED')
    .max(200, 'NOTE_TOO_LONG'),
});
export type AdjustPointsRequest = z.infer<typeof adjustPointsRequestSchema>;

export const putOrderCustomerRequestSchema = z.strictObject({
  phone: customerPhoneSchema,
  name: optionalText(100, 'NAME_TOO_LONG').optional(),
});
export type PutOrderCustomerRequest = z.infer<typeof putOrderCustomerRequestSchema>;

export const putOrderPointsRequestSchema = z.strictObject({
  points: z
    .number({ error: 'POINTS_INVALID' })
    .int('POINTS_INVALID')
    .min(1, 'POINTS_INVALID')
    .max(1_000_000, 'POINTS_INVALID'),
});
export type PutOrderPointsRequest = z.infer<typeof putOrderPointsRequestSchema>;

// ---------------------------------------------------------------------------------------------
// The arithmetic of points, the same for the API and the screens (rules 3 and 4)

// What points are worth, in fils (mils).
export const pointsValueMils = (points: number, loyalty: LoyaltySettings): number =>
  Math.round(points * Number(loyalty.pointValue) * 1000);

// The points an order of this total earns: the total in KWD times the rate, rounded down.
export const pointsEarned = (totalMils: number, loyalty: LoyaltySettings): number =>
  loyalty.enabled ? Math.floor((totalMils * loyalty.pointsPerKwd) / 1000) : 0;

// The most points that can go on an order with this much left to pay: no more than pays it.
export const maxPointsFor = (leftMils: number, loyalty: LoyaltySettings): number => {
  const perPoint = pointsValueMils(1, loyalty);
  return perPoint > 0 ? Math.ceil(leftMils / perPoint) : 0;
};

// What a customer is searched by: the phone and the name.
export const customerSearchText = (phone: string, name: string | null): string =>
  normalizeSearchText(`${phone} ${name ?? ''}`);
