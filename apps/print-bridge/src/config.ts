import { z } from 'zod';

const envSchema = z.object({
  PRINT_BRIDGE_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  // The POS system this bridge prints for, and the key of its branch (made on the branch's
  // Printers tab). Without the key the bridge only answers /health.
  POS_API_URL: z
    .string()
    .url()
    .default('http://localhost:3000')
    .transform((url) => url.replace(/\/$/, '')),
  PRINT_BRIDGE_KEY: z.string().startsWith('pb_').optional(),
  // How long sending to a printer may take before it counts as unreachable.
  PRINTER_TIMEOUT_MS: z.coerce.number().int().min(500).default(5000),
});

export const config = envSchema.parse(process.env);
