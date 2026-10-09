import { z } from 'zod';
import {
  branchConfigChangeSchema,
  branchConfigSchema,
  DEFAULT_TIMEZONE,
  timezoneSchema,
} from './branch-config';
import { localizedNameSchema, localizedTextSchema } from './localized';

export const brandSchema = z.object({
  id: z.uuid(),
  name: localizedTextSchema,
  logoUrl: z.string().nullable(),
  // A brand that is not active keeps its history, but its terminals cannot be signed in to.
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
});

export type Brand = z.infer<typeof brandSchema>;

// A branch as listed. The configuration (hours and printers) comes with a single branch.
export const branchSchema = z.object({
  id: z.uuid(),
  brandId: z.uuid(),
  name: localizedTextSchema,
  address: z.string().nullable(),
  timezone: z.string(),
  isActive: z.boolean(),
});

export type Branch = z.infer<typeof branchSchema>;

export const branchDetailSchema = branchSchema.extend({ config: branchConfigSchema });

export type BranchDetail = z.infer<typeof branchDetailSchema>;

// ---------------------------------------------------------------------------------------------
// Requests. Unknown fields are refused, so a request cannot slip in a field it should not control.

const webUrl = z.url({ protocol: /^https?$/ });

// Until files can be stored, a logo is a link to a picture somewhere else. Only web links are
// accepted, and not ones that carry a user name and password.
export const logoUrlSchema = z
  .string()
  .trim()
  .max(2048, 'LOGO_URL_INVALID')
  .refine(
    (value) => webUrl.safeParse(value).success && !/^https?:\/\/[^/?#]*@/i.test(value),
    'LOGO_URL_INVALID',
  );

// An empty address means none.
const addressSchema = z
  .string()
  .trim()
  .max(300, 'ADDRESS_TOO_LONG')
  .transform((value) => (value === '' ? null : value))
  .nullable();

const somethingToUpdate = (request: object) => Object.keys(request).length > 0;

// A brand can be made inactive from the start, to be set up before it opens.
export const createBrandRequestSchema = z.strictObject({
  name: localizedNameSchema,
  logoUrl: logoUrlSchema.nullable().optional(),
  isActive: z.boolean().default(true),
});

export type CreateBrandRequest = z.infer<typeof createBrandRequestSchema>;

export const updateBrandRequestSchema = z
  .strictObject({
    name: localizedNameSchema.optional(),
    logoUrl: logoUrlSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(somethingToUpdate, { message: 'NOTHING_TO_UPDATE' });

export type UpdateBrandRequest = z.infer<typeof updateBrandRequestSchema>;

export const createBranchRequestSchema = z.strictObject({
  name: localizedNameSchema,
  address: addressSchema.optional(),
  timezone: timezoneSchema.default(DEFAULT_TIMEZONE),
  isActive: z.boolean().default(true),
  config: branchConfigChangeSchema.optional(),
});

export type CreateBranchRequest = z.infer<typeof createBranchRequestSchema>;

export const updateBranchRequestSchema = z
  .strictObject({
    name: localizedNameSchema.optional(),
    address: addressSchema.optional(),
    timezone: timezoneSchema.optional(),
    isActive: z.boolean().optional(),
    config: branchConfigChangeSchema.optional(),
  })
  .refine(somethingToUpdate, { message: 'NOTHING_TO_UPDATE' });

export type UpdateBranchRequest = z.infer<typeof updateBranchRequestSchema>;
