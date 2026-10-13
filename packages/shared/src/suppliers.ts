import { z } from 'zod';
import { ingredientSchema } from './inventory';
import { menuStatusSchema } from './menu';
import { priceSchema } from './money';
import { searchQuerySchema } from './search';

// Who a brand buys from, and at what price. See docs/specs/017-suppliers.md.

export const MAX_SUPPLIER_PRICES = 500;

// An optional text: blank means nothing.
const optionalText = (max: number, code: string) =>
  z
    .string({ error: code })
    .trim()
    .max(max, code)
    .transform((text) => (text === '' ? null : text));

const phoneSchema = z
  .string({ error: 'PHONE_INVALID' })
  .trim()
  .max(30, 'PHONE_INVALID')
  .regex(/^[\d\s+()-]*$/, 'PHONE_INVALID')
  .transform((text) => (text === '' ? null : text));

const emailSchema = z
  .string({ error: 'EMAIL_INVALID' })
  .trim()
  .max(200, 'EMAIL_INVALID')
  .refine((text) => text === '' || z.email().safeParse(text).success, 'EMAIL_INVALID')
  .transform((text) => (text === '' ? null : text.toLowerCase()));

const paymentDaysSchema = z
  .number({ error: 'PAYMENT_DAYS_INVALID' })
  .int('PAYMENT_DAYS_INVALID')
  .min(0, 'PAYMENT_DAYS_INVALID')
  .max(365, 'PAYMENT_DAYS_INVALID');

// ---------------------------------------------------------------------------------------------
// What the API answers

export const supplierSchema = z.object({
  id: z.uuid(),
  brandId: z.uuid(),
  name: z.string(),
  contactName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  paymentDays: z.number().int(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  // How many ingredients have a price from this supplier.
  priceCount: z.number().int(),
});
export type Supplier = z.infer<typeof supplierSchema>;

export const supplierPriceSchema = z.object({
  ingredient: ingredientSchema,
  // Per unit of the ingredient.
  price: z.string(),
  updatedAt: z.iso.datetime(),
});
export type SupplierPrice = z.infer<typeof supplierPriceSchema>;

export const supplierDetailSchema = supplierSchema.extend({
  prices: z.array(supplierPriceSchema),
});
export type SupplierDetail = z.infer<typeof supplierDetailSchema>;

// ---------------------------------------------------------------------------------------------
// Requests

export const supplierListQuerySchema = z.object({
  brandId: z.uuid().optional(),
  q: searchQuerySchema.optional(),
  status: menuStatusSchema.optional(),
});
export type SupplierListQuery = z.infer<typeof supplierListQuerySchema>;

const supplierFields = {
  name: z
    .string({ error: 'SUPPLIER_NAME_REQUIRED' })
    .trim()
    .min(1, 'SUPPLIER_NAME_REQUIRED')
    .max(100, 'NAME_TOO_LONG'),
  contactName: optionalText(100, 'NAME_TOO_LONG'),
  phone: phoneSchema,
  email: emailSchema,
  address: optionalText(300, 'ADDRESS_TOO_LONG'),
  paymentDays: paymentDaysSchema,
  notes: optionalText(500, 'NOTE_TOO_LONG'),
};

export const createSupplierRequestSchema = z.strictObject({
  brandId: z.uuid().optional(),
  name: supplierFields.name,
  contactName: supplierFields.contactName.optional(),
  phone: supplierFields.phone.optional(),
  email: supplierFields.email.optional(),
  address: supplierFields.address.optional(),
  paymentDays: supplierFields.paymentDays.default(0),
  notes: supplierFields.notes.optional(),
});
export type CreateSupplierRequest = z.infer<typeof createSupplierRequestSchema>;

export const updateSupplierRequestSchema = z
  .strictObject({
    name: supplierFields.name.optional(),
    contactName: supplierFields.contactName.optional(),
    phone: supplierFields.phone.optional(),
    email: supplierFields.email.optional(),
    address: supplierFields.address.optional(),
    paymentDays: supplierFields.paymentDays.optional(),
    notes: supplierFields.notes.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((request) => Object.keys(request).length > 0, { message: 'NOTHING_TO_UPDATE' });
export type UpdateSupplierRequest = z.infer<typeof updateSupplierRequestSchema>;

export const putSupplierPricesRequestSchema = z.strictObject({
  prices: z
    .array(
      z.strictObject({
        ingredientId: z.uuid({ error: 'INGREDIENT_REQUIRED' }),
        price: priceSchema,
      }),
    )
    .max(MAX_SUPPLIER_PRICES, 'PRICE_LIST_TOO_LONG')
    .refine(
      (prices) => new Set(prices.map((line) => line.ingredientId)).size === prices.length,
      'INGREDIENT_DUPLICATE',
    ),
});
export type PutSupplierPricesRequest = z.infer<typeof putSupplierPricesRequestSchema>;
