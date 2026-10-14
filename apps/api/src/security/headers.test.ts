import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { loadConfig } from '../config';
import { createTestPrisma, testConfig } from '../../test/helpers';

const prisma = createTestPrisma();
afterAll(() => prisma.$disconnect());

const PRODUCTION = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://pos:secret@db.example.com:5432/pos',
  JWT_ACCESS_SECRET: 'a-real-production-secret-of-at-least-32-chars',
};

describe('the headers of every answer', () => {
  it('forbid scripts, framing, guessing and keeping the answer', async () => {
    const app = createApp({ prisma, config: testConfig() });
    for (const path of ['/api/v1/health', '/api/v1/brands', '/api/v1/nowhere']) {
      const res = await request(app).get(path);
      expect(res.headers).toMatchObject({
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
        'cross-origin-resource-policy': 'same-origin',
        'cache-control': 'no-store',
      });
      expect(res.headers['x-powered-by']).toBeUndefined();
      // Plain HTTP while developing: no promise of HTTPS.
      expect(res.headers['strict-transport-security']).toBeUndefined();
    }
  });

  it('ask for HTTPS in production', async () => {
    const config = { ...loadConfig(PRODUCTION), databaseUrl: testConfig().databaseUrl };
    const res = await request(createApp({ prisma, config })).get('/api/v1/health');
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });
});

describe('the settings of production', () => {
  it('make the sign-in cookie secure', () => {
    expect(loadConfig(PRODUCTION).refreshToken.cookieSecure).toBe(true);
  });

  it('refuse the development secret, a short secret and fast password hashing', () => {
    expect(() =>
      loadConfig({
        ...PRODUCTION,
        JWT_ACCESS_SECRET: 'dev-only-access-token-secret-do-not-use-in-production',
      }),
    ).toThrow('JWT_ACCESS_SECRET must be a secret of your own in production.');
    expect(() => loadConfig({ ...PRODUCTION, JWT_ACCESS_SECRET: 'short' })).toThrow();
    expect(() => loadConfig({ ...PRODUCTION, PASSWORD_HASH_PROFILE: 'fast' })).toThrow(
      'PASSWORD_HASH_PROFILE must be "standard" in production.',
    );
    const { JWT_ACCESS_SECRET: _secret, ...withoutSecret } = PRODUCTION;
    expect(() => loadConfig(withoutSecret)).toThrow();
  });
});
