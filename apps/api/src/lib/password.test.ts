import { describe, expect, it } from 'vitest';
import { createPasswordHasher, hashProfiles } from './password';

const hasher = createPasswordHasher(hashProfiles.fast);

describe('password hasher', () => {
  it('accepts the right secret and rejects a wrong one', async () => {
    const stored = await hasher.hash('1234');

    expect(await hasher.verify('1234', stored)).toBe(true);
    expect(await hasher.verify('1235', stored)).toBe(false);
  });

  it('hashes the same secret differently each time', async () => {
    expect(await hasher.hash('same')).not.toBe(await hasher.hash('same'));
  });

  it('keeps the parameters inside the stored hash', async () => {
    const stored = await hasher.hash('1234');

    expect(stored).toMatch(/^scrypt\$10\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it('still verifies a hash that was made with other parameters', async () => {
    const stored = await hasher.hash('1234');
    const later = createPasswordHasher({ logN: 11, r: 8, p: 1 });

    expect(await later.verify('1234', stored)).toBe(true);
  });

  it('works with the production profile', async () => {
    const standard = createPasswordHasher(hashProfiles.standard);
    const stored = await standard.hash('a production password');

    expect(await standard.verify('a production password', stored)).toBe(true);
    expect(await standard.verify('another password', stored)).toBe(false);
  }, 30_000);

  it('treats text that normalizes to the same characters as equal', async () => {
    const stored = await hasher.hash('ﬁne');

    expect(await hasher.verify('fine', stored)).toBe(true);
  });

  it('handles long secrets with Arabic characters', async () => {
    const long = 'ع'.repeat(200);
    const stored = await hasher.hash(long);

    expect(await hasher.verify(long, stored)).toBe(true);
    expect(await hasher.verify(`${long}x`, stored)).toBe(false);
  });

  it.each([
    '',
    'not-a-hash',
    'bcrypt$10$8$1$c2FsdA==$a2V5',
    'scrypt$10$8$1$c2FsdA==',
    'scrypt$99$8$1$c2FsdA==$a2V5',
    'scrypt$10$0$1$c2FsdA==$a2V5',
    'scrypt$10$8$1$c2FsdA==$a2V5',
    'scrypt$10$8$1$c2FsdA==$a2V5$extra',
  ])('never matches the malformed stored hash "%s"', async (stored) => {
    expect(await hasher.verify('1234', stored)).toBe(false);
  });

  it('can spend the time of a check for an unknown account', async () => {
    await expect(hasher.verifyDummy('anything')).resolves.toBeUndefined();
  });
});
