import { describe, expect, it } from 'vitest';
import { createMemoryMenuCache } from './menu-cache';

const brandA = 'brand-a';
const brandB = 'brand-b';

// A cache with a clock the test moves by hand.
function cacheWithClock(options: { ttlMs?: number; maxEntries?: number } = {}) {
  const clock = { now: 1_000 };
  const cache = createMemoryMenuCache({ ...options, now: () => clock.now });
  return { cache, clock };
}

async function store(
  cache: ReturnType<typeof createMemoryMenuCache>,
  brandId: string,
  branchId: string,
  json: string,
) {
  await cache.set(brandId, branchId, json, await cache.begin(brandId));
}

describe('the menu cache', () => {
  it('gives back what was stored, and nothing for a branch that was not', async () => {
    const { cache } = cacheWithClock();
    await store(cache, brandA, 'mall', '{"menu":1}');

    expect(await cache.get(brandA, 'mall')).toBe('{"menu":1}');
    expect(await cache.get(brandA, 'downtown')).toBeNull();
    expect(await cache.get(brandB, 'mall')).toBeNull();
  });

  it('counts what it answered from memory and what it could not', async () => {
    const { cache } = cacheWithClock();
    await store(cache, brandA, 'mall', 'x');

    await cache.get(brandA, 'mall');
    await cache.get(brandA, 'mall');
    await cache.get(brandA, 'other');

    expect(cache.stats()).toEqual({ hits: 2, misses: 1, size: 1 });
  });

  it('forgets a menu when its time is up', async () => {
    const { cache, clock } = cacheWithClock({ ttlMs: 60_000 });
    await store(cache, brandA, 'mall', 'x');

    clock.now += 59_999;
    expect(await cache.get(brandA, 'mall')).toBe('x');
    clock.now += 2;
    expect(await cache.get(brandA, 'mall')).toBeNull();
    expect(cache.stats().size).toBe(0);
  });

  it('clears every branch of a brand when the brand is cleared, and no other brand', async () => {
    const { cache } = cacheWithClock();
    await store(cache, brandA, 'mall', 'a1');
    await store(cache, brandA, 'downtown', 'a2');
    await store(cache, brandB, 'airport', 'b1');

    await cache.invalidate(brandA);

    expect(await cache.get(brandA, 'mall')).toBeNull();
    expect(await cache.get(brandA, 'downtown')).toBeNull();
    expect(await cache.get(brandB, 'airport')).toBe('b1');
  });

  it('clears one branch when only that branch is cleared', async () => {
    const { cache } = cacheWithClock();
    await store(cache, brandA, 'mall', 'a1');
    await store(cache, brandA, 'downtown', 'a2');

    await cache.invalidate(brandA, 'mall');

    expect(await cache.get(brandA, 'mall')).toBeNull();
    expect(await cache.get(brandA, 'downtown')).toBe('a2');
  });

  it('does not keep a menu that was built while the brand was cleared', async () => {
    const { cache } = cacheWithClock();
    const token = await cache.begin(brandA);

    await cache.invalidate(brandA);
    await cache.set(brandA, 'mall', 'old menu', token);

    expect(await cache.get(brandA, 'mall')).toBeNull();
  });

  it('keeps a menu that was built after the last clearing', async () => {
    const { cache } = cacheWithClock();
    await cache.invalidate(brandA);
    const token = await cache.begin(brandA);

    await cache.set(brandA, 'mall', 'new menu', token);

    expect(await cache.get(brandA, 'mall')).toBe('new menu');
  });

  it('does not let a clearing of one brand spoil a menu being built for another', async () => {
    const { cache } = cacheWithClock();
    const token = await cache.begin(brandB);

    await cache.invalidate(brandA);
    await cache.set(brandB, 'airport', 'b menu', token);

    expect(await cache.get(brandB, 'airport')).toBe('b menu');
  });

  it('replaces a menu stored again for the same branch', async () => {
    const { cache } = cacheWithClock();
    await store(cache, brandA, 'mall', 'first');
    await store(cache, brandA, 'mall', 'second');

    expect(await cache.get(brandA, 'mall')).toBe('second');
    expect(cache.stats().size).toBe(1);
  });

  it('drops the oldest menu when it holds more than its limit', async () => {
    const { cache } = cacheWithClock({ maxEntries: 2 });
    await store(cache, brandA, 'one', '1');
    await store(cache, brandA, 'two', '2');
    await store(cache, brandA, 'three', '3');

    expect(await cache.get(brandA, 'one')).toBeNull();
    expect(await cache.get(brandA, 'two')).toBe('2');
    expect(await cache.get(brandA, 'three')).toBe('3');
  });
});
