import { z } from 'zod';

const envSchema = z.object({
  PRINT_BRIDGE_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
});

export const config = envSchema.parse(process.env);
