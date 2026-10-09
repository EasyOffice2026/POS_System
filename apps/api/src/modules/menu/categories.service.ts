import {
  type CategoryListQuery,
  type CreateCategoryRequest,
  MAX_CATEGORIES,
  type MenuCategory,
  type ReorderCategoriesRequest,
  type UpdateCategoryRequest,
} from '@pos/shared';
import { isDeepStrictEqual } from 'node:util';
import type { MenuCategory as CategoryRow, Prisma } from '../../generated/prisma/client';
import { errors } from '../../lib/http-errors';
import type { RequestMeta } from '../../lib/request-meta';
import type { ActorContext } from '../../middleware/authenticate';
import {
  invalid,
  LIST_LIMIT,
  type MenuDeps,
  resolveBrandId,
  statusFilter,
  toMenuCategory,
} from './menu.common';

// Categories of the menu of a brand, in the order they are shown. See docs/specs/004-menu.md.
export function createCategoriesService({ audit, cache }: MenuDeps) {
  // A category the actor cannot see is answered like one that does not exist.
  async function load({ db }: ActorContext, id: string): Promise<CategoryRow> {
    const category = await db.menuCategory.findUnique({ where: { id } });
    if (!category) throw errors.notFound('Menu category');
    return category;
  }

  return {
    async list({ db }: ActorContext, query: CategoryListQuery): Promise<MenuCategory[]> {
      const rows = await db.menuCategory.findMany({
        where: {
          ...(query.brandId ? { brandId: query.brandId } : {}),
          ...statusFilter(query.status),
        },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        take: LIST_LIMIT,
      });
      return rows.map(toMenuCategory);
    },

    async create(
      ctx: ActorContext,
      input: CreateCategoryRequest,
      meta: RequestMeta,
    ): Promise<MenuCategory> {
      const { auth, db } = ctx;
      const brandId = await resolveBrandId(ctx, input.brandId);

      // A new category goes last. A brand can have this many, so that all of them can be put in
      // a new order in one request.
      const existing = await db.menuCategory.aggregate({
        where: { brandId },
        _count: { _all: true },
        _max: { sortOrder: true },
      });
      if (existing._count._all >= MAX_CATEGORIES) {
        throw errors.conflict(
          'CATEGORY_LIMIT',
          `A brand can have at most ${MAX_CATEGORIES} categories`,
        );
      }

      const category = await db.menuCategory.create({
        data: {
          brandId,
          name: input.name,
          isActive: input.isActive,
          sortOrder: (existing._max.sortOrder ?? -1) + 1,
        },
      });

      await audit(
        {
          action: 'menu.category.created',
          userId: auth.sub,
          brandId,
          entityType: 'menu_category',
          entityId: category.id,
          metadata: { name: input.name, isActive: category.isActive },
        },
        meta,
      );
      await cache.invalidate(brandId);
      return toMenuCategory(category);
    },

    async update(
      ctx: ActorContext,
      id: string,
      input: UpdateCategoryRequest,
      meta: RequestMeta,
    ): Promise<MenuCategory> {
      const { auth, db } = ctx;
      const target = await load(ctx, id);

      const data: Prisma.MenuCategoryUpdateInput = {};
      const changed: string[] = [];

      if (input.name !== undefined && !isDeepStrictEqual(input.name, toMenuCategory(target).name)) {
        data.name = input.name;
        changed.push('name');
      }
      if (input.isActive !== undefined && input.isActive !== target.isActive) {
        data.isActive = input.isActive;
        changed.push('isActive');
      }
      if (changed.length === 0) return toMenuCategory(target);

      const updated = await db.menuCategory.update({ where: { id }, data });

      await audit(
        {
          action: 'menu.category.updated',
          userId: auth.sub,
          brandId: target.brandId,
          entityType: 'menu_category',
          entityId: id,
          metadata: {
            changed,
            ...(changed.includes('isActive') ? { isActive: updated.isActive } : {}),
          },
        },
        meta,
      );
      await cache.invalidate(target.brandId);
      return toMenuCategory(updated);
    },

    // Puts all the categories of a brand in a new order. The request names every one of them.
    async reorder(
      ctx: ActorContext,
      input: ReorderCategoriesRequest,
      meta: RequestMeta,
    ): Promise<MenuCategory[]> {
      const { auth, db } = ctx;
      const brandId = await resolveBrandId(ctx, input.brandId);

      const rows = await db.menuCategory.findMany({
        where: { brandId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });
      const known = new Set(rows.map((row) => row.id));
      if (rows.length !== input.ids.length || input.ids.some((id) => !known.has(id))) {
        throw invalid('ids', 'ORDER_MISMATCH');
      }

      const byId = new Map(rows.map((row) => [row.id, row]));
      const ordered = input.ids.map((id, index) => ({
        ...(byId.get(id) as CategoryRow),
        sortOrder: index,
      }));

      const sameOrder = rows.every((row, index) => row.id === input.ids[index]);
      if (sameOrder) return rows.map(toMenuCategory);

      await db.$transaction(async (tx) => {
        for (const category of ordered) {
          if (byId.get(category.id)?.sortOrder !== category.sortOrder) {
            await tx.menuCategory.update({
              where: { id: category.id },
              data: { sortOrder: category.sortOrder },
            });
          }
        }
      });

      await audit(
        {
          action: 'menu.category.reordered',
          userId: auth.sub,
          brandId,
          entityType: 'menu_category',
          metadata: { count: ordered.length },
        },
        meta,
      );
      await cache.invalidate(brandId);
      return ordered.map(toMenuCategory);
    },
  };
}
