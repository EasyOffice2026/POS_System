import {
  type BranchOverride,
  type CreateItemRequest,
  type ItemListQuery,
  type MenuItem,
  type MenuItemDetail,
  normalizeSearchText,
  type Page,
  type PutBranchOverrideRequest,
  searchTextOf,
  type UpdateItemRequest,
} from '@pos/shared';
import { isDeepStrictEqual } from 'node:util';
import { type MenuItem as ItemRow, Prisma } from '../../generated/prisma/client';
import { errors } from '../../lib/http-errors';
import { cursorPageArgs, toPage } from '../../lib/pagination';
import type { RequestMeta } from '../../lib/request-meta';
import type { ActorContext } from '../../middleware/authenticate';
import type { ScopedClient } from '../../tenancy/scoped-client';
import {
  invalid,
  loadGroups,
  type MenuDeps,
  money,
  resolveBrandId,
  statusFilter,
  toBranchOverride,
  toMenuItem,
} from './menu.common';

// In a search, % and _ are letters like the others, not wildcards. The database reads a backslash
// before them as "the character itself".
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (character) => `\\${character}`);

// Items of the menu of a brand, and what each branch changes about them. See
// docs/specs/004-menu.md.
export function createItemsService({ audit, cache }: MenuDeps) {
  // An item the actor cannot see is answered like one that does not exist.
  async function load({ db }: ActorContext, id: string): Promise<ItemRow> {
    const item = await db.menuItem.findUnique({ where: { id } });
    if (!item) throw errors.notFound('Menu item');
    return item;
  }

  async function describeOne(db: ScopedClient, row: ItemRow): Promise<MenuItemDetail> {
    const groups = await loadGroups(db, [row.id]);
    return { ...toMenuItem(row), modifierGroups: groups.get(row.id) ?? [] };
  }

  // A category of another brand is answered as one that does not exist.
  async function assertCategory(db: ScopedClient, brandId: string, categoryId: string) {
    const category = await db.menuCategory.findFirst({
      where: { id: categoryId, brandId },
      select: { id: true },
    });
    if (!category) throw invalid('categoryId', 'CATEGORY_NOT_FOUND');
  }

  return {
    async list({ db }: ActorContext, query: ItemListQuery): Promise<Page<MenuItem>> {
      const filters: Prisma.MenuItemWhereInput[] = [];
      if (query.brandId) filters.push({ brandId: query.brandId });
      if (query.categoryId) filters.push({ categoryId: query.categoryId });
      filters.push(statusFilter(query.status));

      // Every word typed has to be somewhere in a name, in either language.
      for (const word of normalizeSearchText(query.q ?? '').split(' ')) {
        if (word) filters.push({ searchText: { contains: escapeLike(word) } });
      }

      const rows = await db.menuItem.findMany({
        where: { AND: filters },
        ...cursorPageArgs(query.limit, query.cursor),
        // The search text starts with the English name, so this is the order of English names.
        orderBy: [{ searchText: 'asc' }, { id: 'asc' }],
      });
      return toPage(rows, query.limit, toMenuItem);
    },

    async get(ctx: ActorContext, id: string): Promise<MenuItemDetail> {
      return describeOne(ctx.db, await load(ctx, id));
    },

    async create(
      ctx: ActorContext,
      input: CreateItemRequest,
      meta: RequestMeta,
    ): Promise<MenuItemDetail> {
      const { auth, db } = ctx;
      const brandId = await resolveBrandId(ctx, input.brandId);
      await assertCategory(db, brandId, input.categoryId);

      const item = await db.menuItem.create({
        data: {
          brandId,
          categoryId: input.categoryId,
          name: input.name,
          searchText: searchTextOf(input.name),
          basePrice: input.basePrice,
          isActive: input.isActive,
          ...(input.description ? { description: input.description } : {}),
          ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
        },
      });

      await audit(
        {
          action: 'menu.item.created',
          userId: auth.sub,
          brandId,
          entityType: 'menu_item',
          entityId: item.id,
          metadata: {
            name: input.name,
            categoryId: input.categoryId,
            basePrice: money(item.basePrice),
          },
        },
        meta,
      );
      await cache.invalidate(brandId);
      return describeOne(db, item);
    },

    async update(
      ctx: ActorContext,
      id: string,
      input: UpdateItemRequest,
      meta: RequestMeta,
    ): Promise<MenuItemDetail> {
      const { auth, db } = ctx;
      const target = await load(ctx, id);
      const current = toMenuItem(target);

      const data: Prisma.MenuItemUncheckedUpdateInput = {};
      const changed: string[] = [];

      if (input.categoryId !== undefined && input.categoryId !== target.categoryId) {
        await assertCategory(db, target.brandId, input.categoryId);
        data.categoryId = input.categoryId;
        changed.push('category');
      }
      if (input.name !== undefined && !isDeepStrictEqual(input.name, current.name)) {
        data.name = input.name;
        data.searchText = searchTextOf(input.name);
        changed.push('name');
      }
      if (
        input.description !== undefined &&
        !isDeepStrictEqual(input.description, current.description)
      ) {
        data.description = input.description === null ? Prisma.DbNull : input.description;
        changed.push('description');
      }
      if (input.basePrice !== undefined && input.basePrice !== current.basePrice) {
        data.basePrice = input.basePrice;
        changed.push('basePrice');
      }
      if (input.imageUrl !== undefined && input.imageUrl !== target.imageUrl) {
        data.imageUrl = input.imageUrl;
        changed.push('imageUrl');
      }
      if (input.isActive !== undefined && input.isActive !== target.isActive) {
        data.isActive = input.isActive;
        changed.push('isActive');
      }
      if (changed.length === 0) return describeOne(db, target);

      const updated = await db.menuItem.update({ where: { id }, data });

      await audit(
        {
          action: 'menu.item.updated',
          userId: auth.sub,
          brandId: target.brandId,
          entityType: 'menu_item',
          entityId: id,
          metadata: {
            changed,
            ...(changed.includes('basePrice')
              ? { basePrice: { from: current.basePrice, to: money(updated.basePrice) } }
              : {}),
            ...(changed.includes('isActive') ? { isActive: updated.isActive } : {}),
          },
        },
        meta,
      );
      await cache.invalidate(target.brandId);
      return describeOne(db, updated);
    },

    // What each branch changes about the item. A branch with no changes is not in the list.
    async listOverrides(ctx: ActorContext, itemId: string): Promise<BranchOverride[]> {
      await load(ctx, itemId);

      const rows = await ctx.db.branchMenuItem.findMany({
        where: { itemId },
        orderBy: { branchId: 'asc' },
      });
      return rows.map(toBranchOverride);
    },

    // Sets all of what one branch changes about the item. A request that puts everything back to
    // the brand's values removes the override, because a branch only stores differences.
    async putOverride(
      ctx: ActorContext,
      itemId: string,
      input: PutBranchOverrideRequest,
      meta: RequestMeta,
    ): Promise<BranchOverride> {
      const { auth, db } = ctx;
      const item = await load(ctx, itemId);

      const branch = await db.branch.findFirst({
        where: { id: input.branchId, brandId: item.brandId },
        select: { id: true },
      });
      if (!branch) throw invalid('branchId', 'BRANCH_NOT_FOUND');

      const where = { branchId_itemId: { branchId: input.branchId, itemId } };
      const existing = await db.branchMenuItem.findUnique({ where });
      const result: BranchOverride = {
        itemId,
        branchId: input.branchId,
        price: input.price,
        isAvailable: input.isAvailable,
        schedule: input.schedule,
      };

      if (input.price === null && input.isAvailable && input.schedule === null) {
        if (!existing) return result;
        await db.branchMenuItem.delete({ where });
      } else {
        if (existing && isDeepStrictEqual(toBranchOverride(existing), result)) return result;

        const data = {
          priceOverride: input.price,
          isAvailable: input.isAvailable,
          schedule: input.schedule ?? Prisma.DbNull,
        };
        if (existing) {
          await db.branchMenuItem.update({ where, data });
        } else {
          await db.branchMenuItem.create({
            data: { branchId: input.branchId, itemId, brandId: item.brandId, ...data },
          });
        }
      }

      await audit(
        {
          action: 'menu.item.branch_override_set',
          userId: auth.sub,
          brandId: item.brandId,
          branchId: input.branchId,
          entityType: 'menu_item',
          entityId: itemId,
          metadata: {
            price: input.price,
            isAvailable: input.isAvailable,
            scheduled: input.schedule !== null,
          },
        },
        meta,
      );
      // Only this branch's menu changes.
      await cache.invalidate(item.brandId, input.branchId);
      return result;
    },
  };
}
