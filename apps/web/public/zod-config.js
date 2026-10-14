// Read by zod before it loads: never try eval, which the security policy of the web app forbids
// (apps/web/nginx/security-headers.conf). Without it zod tries once and the browser reports it.
globalThis.__zod_globalConfig = { ...globalThis.__zod_globalConfig, jitless: true };
