import {
  type CreatePromotionRequest,
  localizedTextSchema,
  type Promotion,
  type PromotionListQuery,
  type UpdatePromotionRequest,
} from '@pos/shared';
import type { Promotion as PromotionRow } from '../../generated/prisma/client';
import { errors } from '../../lib/http-errors';
import type { RequestMeta } from '../../lib/request-meta';
import type { ActorContext } from '../../middleware/authenticate';
import type { ScopedClient } from '../../tenancy/scoped-client';
import { dbDate, isUniqueViolation } from '../orders/orders.common';
import { invalid, LIST_LIMIT, type MenuDeps, resolveBrandId, statusFilter } from './menu.common';

const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

export function toPromotion(row: PromotionRow): Promotion {
  return {
    id: row.id,
    brandId: row.brandId,
    name: localizedTextSchema.parse(row.name),
    kind: row.kind,
    value:
      row.value === null
        ? null
        : row.kind === 'percent_off'
          ? row.value.toFixed(2)
          : row.value.toFixed(3),
    buyQuantity: row.buyQuantity,
    getQuantity: row.getQuantity,
    appliesTo: row.appliesTo,
    categoryIds: row.categoryIds,
    itemIds: row.itemIds,
    branchIds: row.branchIds,
    startsOn: day(row.startsOn),
    endsOn: day(row.endsOn),
    days: row.days,
    startTime: row.startTime,
    endTime: row.endTime,
    code: row.code,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
}

type PromotionInput = UpdatePromotionRequest;

const codeTaken = () => invalid('code', 'PROMO_CODE_TAKEN');

// Discounts a brand sets up once and the POS applies by itself. See docs/specs/021-promotions.md.
export function createPromotionsService({ audit }: MenuDeps) {
  async function loadPromotion(db: ScopedClient, id: string): Promise<PromotionRow> {
    const row = await db.promotion.findUnique({ where: { id } });
    if (!row) throw errors.notFound('Promotion');
    return row;
  }

  // The categories, dishes and branches named must be the brand's own.
  async function checkTargets(db: ScopedClient, brandId: string, input: PromotionInput) {
    const check = async (
      path: string,
      ids: string[],
      find: (ids: string[]) => Promise<{ id: string }[]>,
      code: string,
    ) => {
      if (ids.length === 0) return;
      const found = new Set((await find(ids)).map((row) => row.id));
      const missing = ids.findIndex((id) => !found.has(id));
      if (missing >= 0) throw invalid(`${path}.${missing}`, code);
    };
    await check(
      'categoryIds',
      input.categoryIds,
      (ids) => db.menuCategory.findMany({ where: { id: { in: ids }, brandId } }),
      'CATEGORY_NOT_FOUND',
    );
    await check(
      'itemIds',
      input.itemIds,
      (ids) => db.menuItem.findMany({ where: { id: { in: ids }, brandId } }),
      'ITEM_NOT_FOUND',
    );
    await check(
      'branchIds',
      input.branchIds,
      (ids) => db.branch.findMany({ where: { id: { in: ids }, brandId } }),
      'BRANCH_NOT_FOUND',
    );
  }

  const dataOf = (input: PromotionInput) => ({
    name: input.name,
    kind: input.kind,
    value: input.value,
    buyQuantity: input.buyQuantity ?? null,
    getQuantity: input.getQuantity ?? null,
    appliesTo: input.appliesTo,
    categoryIds: input.categoryIds,
    itemIds: input.itemIds,
    branchIds: input.branchIds,
    startsOn: input.startsOn ? dbDate(input.startsOn) : null,
    endsOn: input.endsOn ? dbDate(input.endsOn) : null,
    days: input.days,
    startTime: input.startTime,
    endTime: input.endTime,
    code: input.code,
    sortOrder: input.sortOrder,
    isActive: input.isActive,
  });

  return {
    async list({ db }: ActorContext, query: PromotionListQuery): Promise<Promotion[]> {
      const rows = await db.promotion.findMany({
        where: {
          ...(query.brandId ? { brandId: query.brandId } : {}),
          ...statusFilter(query.status),
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        take: LIST_LIMIT,
      });
      return rows.map(toPromotion);
    },

    async get({ db }: ActorContext, id: string): Promise<Promotion> {
      return toPromotion(await loadPromotion(db, id));
    },

    async create(
      ctx: ActorContext,
      input: CreatePromotionRequest,
      meta: RequestMeta,
    ): Promise<Promotion> {
      const { auth, db } = ctx;
      const brandId = await resolveBrandId(ctx, input.brandId);
      await checkTargets(db, brandId, input);
      let row: PromotionRow;
      try {
        row = await db.promotion.create({ data: { brandId, ...dataOf(input) } });
      } catch (error) {
        if (isUniqueViolation(error)) throw codeTaken();
        throw error;
      }
      await audit(
        {
          action: 'menu.promotion.created',
          userId: auth.sub,
          brandId,
          entityType: 'promotion',
          entityId: row.id,
          metadata: { name: input.name, kind: input.kind, code: input.code },
        },
        meta,
      );
      return toPromotion(row);
    },

    // A change sends the whole promotion again.
    async update(
      ctx: ActorContext,
      id: string,
      input: UpdatePromotionRequest,
      meta: RequestMeta,
    ): Promise<Promotion> {
      const { auth, db } = ctx;
      const target = await loadPromotion(db, id);
      await checkTargets(db, target.brandId, input);
      let row: PromotionRow;
      try {
        row = await db.promotion.update({ where: { id }, data: dataOf(input) });
      } catch (error) {
        if (isUniqueViolation(error)) throw codeTaken();
        throw error;
      }
      await audit(
        {
          action: 'menu.promotion.updated',
          userId: auth.sub,
          brandId: target.brandId,
          entityType: 'promotion',
          entityId: id,
          metadata: { name: input.name, isActive: input.isActive },
        },
        meta,
      );
      return toPromotion(row);
    },
  };
}

export type PromotionsService = ReturnType<typeof createPromotionsService>;
