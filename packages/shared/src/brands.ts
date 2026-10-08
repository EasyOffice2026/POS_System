import { z } from 'zod';
import { localizedTextSchema } from './localized';

export const brandSchema = z.object({
  id: z.uuid(),
  name: localizedTextSchema,
  logoUrl: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export type Brand = z.infer<typeof brandSchema>;

export const branchSchema = z.object({
  id: z.uuid(),
  brandId: z.uuid(),
  name: localizedTextSchema,
  address: z.string().nullable(),
  timezone: z.string(),
  isActive: z.boolean(),
});

export type Branch = z.infer<typeof branchSchema>;
