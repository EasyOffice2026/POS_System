// Keeps the menu of each branch, as the text a terminal receives, so a terminal that loads it again
// is answered without asking the database. See docs/specs/004-menu.md.
//
// The cache is cleared when anything in a brand's menu changes. A menu that was being built while
// the change happened must not be kept, because it may be the old one: so a build starts with
// `begin` and its result is stored only if nothing was cleared since.
//
// Today the menus are kept in the memory of this API process, which is right for one process. A
// second process would not see the other's changes, so more than one needs a shared store (the
// plan is Redis) behind this same interface: `begin` is a counter per brand, and `invalidate`
// raises it.

export interface MenuCache {
  get(brandId: string, branchId: string): Promise<string | null>;
  // The state of the brand's menu, taken before the menu is built.
  begin(brandId: string): Promise<number>;
  // Stores a menu built after `begin(brandId)` returned `token`. Nothing is stored if the brand's
  // menu changed in between.
  set(brandId: string, branchId: string, json: string, token: number): Promise<void>;
  // A change to the menu of a brand clears all its branches. A change that concerns one branch
  // (its price of an item) clears only that branch.
  invalidate(brandId: string, branchId?: string): Promise<void>;
}

export interface MemoryMenuCache extends MenuCache {
  stats(): { hits: number; misses: number; size: number };
}

interface Options {
  // How long a menu is kept if nothing clears it first. A safety net, not the way it is cleared.
  ttlMs?: number;
  // The most menus kept. The oldest goes first.
  maxEntries?: number;
  now?: () => number;
}

export function createMemoryMenuCache({
  ttlMs = 5 * 60 * 1000,
  maxEntries = 1000,
  now = Date.now,
}: Options = {}): MemoryMenuCache {
  const entries = new Map<string, { json: string; expiresAt: number }>();
  const versions = new Map<string, number>();
  let hits = 0;
  let misses = 0;

  const key = (brandId: string, branchId: string) => `${brandId}/${branchId}`;
  const version = (brandId: string) => versions.get(brandId) ?? 0;

  return {
    get(brandId, branchId) {
      const name = key(brandId, branchId);
      const entry = entries.get(name);

      if (entry && entry.expiresAt > now()) {
        hits += 1;
        return Promise.resolve(entry.json);
      }
      if (entry) entries.delete(name);
      misses += 1;
      return Promise.resolve(null);
    },

    begin(brandId) {
      return Promise.resolve(version(brandId));
    },

    set(brandId, branchId, json, token) {
      if (token !== version(brandId)) return Promise.resolve();

      const name = key(brandId, branchId);
      entries.delete(name);
      entries.set(name, { json, expiresAt: now() + ttlMs });

      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      return Promise.resolve();
    },

    invalidate(brandId, branchId) {
      versions.set(brandId, version(brandId) + 1);

      if (branchId) {
        entries.delete(key(brandId, branchId));
        return Promise.resolve();
      }
      for (const name of [...entries.keys()]) {
        if (name.startsWith(`${brandId}/`)) entries.delete(name);
      }
      return Promise.resolve();
    },

    stats() {
      return { hits, misses, size: entries.size };
    },
  };
}
