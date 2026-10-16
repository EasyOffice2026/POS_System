import { z } from 'zod';
import type { HashProfileName } from './lib/password';

// Development defaults match docker-compose.yml. Production must set its own values.
const DEV_DATABASE_URL = 'postgresql://pos:pos@localhost:5432/pos';
const DEV_JWT_SECRET = 'dev-only-access-token-secret-do-not-use-in-production';

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  // Number of reverse proxies in front of the API (0 when none). Needed for correct client IPs.
  trustProxy: number;
  passwordHashProfile: HashProfileName;
  accessToken: { secret: string; ttlSeconds: number };
  refreshToken: {
    ttlDays: number;
    pinSessionHours: number;
    cookieName: string;
    cookieSecure: boolean;
  };
  // Failed sign-in or refresh requests allowed per IP address in the window.
  authRateLimit: { windowMs: number; max: number };
  // How long the menu of a branch is kept if nothing changes it (it is also cleared by every change).
  menuCacheTtlSeconds: number;
  // The email account alerts go out from (smtp://user:password@host:port), and the sender shown.
  mail: { smtpUrl: string | undefined; from: string | undefined };
  // Supabase Storage for photos: the project address, its service role key, and the bucket.
  storage: { supabaseUrl: string | undefined; serviceRoleKey: string | undefined; bucket: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';

  const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: production ? z.string().min(1) : z.string().min(1).default(DEV_DATABASE_URL),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    PASSWORD_HASH_PROFILE: z.enum(['standard', 'fast']).default('standard'),
    JWT_ACCESS_SECRET: production ? z.string().min(32) : z.string().min(32).default(DEV_JWT_SECRET),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .default(15 * 60),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(7),
    // How long a till stays signed in with a PIN before it asks for it again (the client: a day).
    PIN_SESSION_HOURS: z.coerce.number().int().min(1).default(24),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(30),
    SMTP_URL: z.string().url().optional(),
    ALERT_FROM: z.string().min(3).optional(),
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
    STORAGE_BUCKET: z.string().min(1).default('pos-images'),
    MENU_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .default(5 * 60),
  });

  const values = schema.parse(env);
  if (production && values.PASSWORD_HASH_PROFILE !== 'standard') {
    throw new Error('PASSWORD_HASH_PROFILE must be "standard" in production.');
  }
  // The development secret is in the code for everyone to read; anyone could sign tokens with it.
  if (production && values.JWT_ACCESS_SECRET === DEV_JWT_SECRET) {
    throw new Error('JWT_ACCESS_SECRET must be a secret of your own in production.');
  }

  return {
    nodeEnv: values.NODE_ENV,
    port: values.API_PORT,
    databaseUrl: values.DATABASE_URL,
    trustProxy: values.TRUST_PROXY,
    passwordHashProfile: values.PASSWORD_HASH_PROFILE,
    accessToken: { secret: values.JWT_ACCESS_SECRET, ttlSeconds: values.ACCESS_TOKEN_TTL_SECONDS },
    refreshToken: {
      ttlDays: values.REFRESH_TOKEN_TTL_DAYS,
      pinSessionHours: values.PIN_SESSION_HOURS,
      cookieName: 'pos_refresh',
      cookieSecure: production,
    },
    authRateLimit: { windowMs: 15 * 60 * 1000, max: values.AUTH_RATE_LIMIT_MAX },
    menuCacheTtlSeconds: values.MENU_CACHE_TTL_SECONDS,
    mail: { smtpUrl: values.SMTP_URL, from: values.ALERT_FROM },
    storage: {
      supabaseUrl: values.SUPABASE_URL,
      serviceRoleKey: values.SUPABASE_SERVICE_ROLE_KEY,
      bucket: values.STORAGE_BUCKET,
    },
  };
}
