import {
  type BranchMenu,
  type BranchMenuItem,
  CURRENCY,
  openingHoursSchema,
  parseBranchConfig,
} from '@pos/shared';
import type { Branch as BranchRow } from '../../generated/prisma/client';
import { errors } from '../../lib/http-errors';
import type { ActorContext } from '../../middleware/authenticate';
import type { ScopedClient } from '../../tenancy/scoped-client';
import {
  describeCombos,
  loadGroups,
  type MenuDeps,
  money,
  toMenuCategory,
  toMenuItem,
} from './menu.common';

// The menu of one branch, as its terminal loads it: only what can be sold there, with the price of
// that branch. See docs/specs/004-menu.md.
export function createBranchMenuService({ cache }: Pick<MenuDeps, 'cache'>) {
  async function build(db: ScopedClient, branch: BranchRow): Promise<BranchMenu> {
    const brandId = branch.brandId;

    const [categories, items, overrides, comboRows] = await Promise.all([
      db.menuCategory.findMany({
        where: { brandId, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      db.menuItem.findMany({
        where: { brandId, isActive: true },
        // The English name is first in the search text, so this is the order of English names.
        orderBy: [{ searchText: 'asc' }, { id: 'asc' }],
      }),
      db.branchMenuItem.findMany({ where: { branchId: branch.id } }),
      db.combo.findMany({ where: { brandId, isActive: true }, orderBy: { id: 'asc' } }),
    ]);

    const overrideOf = new Map(overrides.map((override) => [override.itemId, override]));
    const shown = new Set(categories.map((category) => category.id));

    // Items of a category that is switched off are not sold, and nor are items this branch has
    // switched off.
    const sellable = items.filter(
      (item) => shown.has(item.categoryId) && overrideOf.get(item.id)?.isAvailable !== false,
    );
    const groups = await loadGroups(
      db,
      sellable.map((item) => item.id),
    );

    const menuItems = new Map<string, BranchMenuItem[]>();
    for (const item of sellable) {
      const base = toMenuItem(item);
      const override = overrideOf.get(item.id);
      const schedule = openingHoursSchema.safeParse(override?.schedule);

      // Groups and modifiers that are switched off are not offered, and a group with nothing left
      // to choose from is not shown.
      const modifierGroups = (groups.get(item.id) ?? [])
        .filter((group) => group.isActive)
        .map((group) => ({
          id: group.id,
          name: group.name,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          modifiers: group.modifiers
            .filter((modifier) => modifier.isActive)
            .map(({ id, name, priceDelta }) => ({ id, name, priceDelta })),
        }))
        .filter((group) => group.modifiers.length > 0);

      const entry: BranchMenuItem = {
        id: item.id,
        name: base.name,
        description: base.description,
        price: override?.priceOverride ? money(override.priceOverride) : base.basePrice,
        imageUrl: base.imageUrl,
        schedule: schedule.success ? schedule.data : null,
        modifierGroups,
      };
      menuItems.set(item.categoryId, [...(menuItems.get(item.categoryId) ?? []), entry]);
    }

    const menuCategories = categories
      .filter((category) => menuItems.has(category.id))
      .map((category) => ({
        id: category.id,
        name: toMenuCategory(category).name,
        items: menuItems.get(category.id) ?? [],
      }));

    // A combo is offered with the choices that can be sold here, and not at all when one of its
    // slots has no choice left.
    const sellableIds = new Set(sellable.map((item) => item.id));
    const combos = (await describeCombos(db, comboRows)).flatMap((combo) => {
      const slots = combo.slots.map((slot) => ({
        ...slot,
        options: slot.options.filter((option) => sellableIds.has(option.itemId)),
      }));
      return slots.every((slot) => slot.options.length > 0)
        ? [{ id: combo.id, name: combo.name, price: combo.price, slots }]
        : [];
    });

    return {
      branchId: branch.id,
      brandId,
      currency: CURRENCY,
      timezone: branch.timezone,
      kitchen: parseBranchConfig(branch.config).kitchen,
      categories: menuCategories,
      combos,
    };
  }

  return {
    // The menu as the text that is sent. It is answered from the cache when it is there.
    async load({ db }: ActorContext, branchId: string): Promise<string> {
      // A branch the actor cannot see is answered like one that does not exist, before the cache
      // is looked at.
      const branch = await db.branch.findUnique({ where: { id: branchId } });
      if (!branch) throw errors.notFound('Branch');

      const cached = await cache.get(branch.brandId, branch.id);
      if (cached !== null) return cached;

      const token = await cache.begin(branch.brandId);
      const json = JSON.stringify(await build(db, branch));
      await cache.set(branch.brandId, branch.id, json, token);
      return json;
    },
  };
}
