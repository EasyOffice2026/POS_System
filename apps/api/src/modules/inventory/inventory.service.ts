import {
  type BranchStockAlerts,
  type BranchStock,
  type CreateIngredientRequest,
  type CreateMovementRequest,
  fromMils,
  type Ingredient,
  type IngredientListQuery,
  localizedTextSchema,
  type MovementListQuery,
  normalizeSearchText,
  type Page,
  searchTextOf,
  type SetLowLevelRequest,
  type StockAlertsQuery,
  type StockListQuery,
  type StockMovement,
  toMils,
  type UpdateIngredientRequest,
} from '@pos/shared';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type {
  BranchStock as StockRow,
  Ingredient as IngredientRow,
  Prisma,
  StockMovement as MovementRow,
} from '../../generated/prisma/client';
import { type AuditEvent, writeAudit } from '../../lib/audit';
import { errors } from '../../lib/http-errors';
import { cursorPageArgs, splitPage, toPage } from '../../lib/pagination';
import type { PrismaClient } from '../../lib/prisma';
import type { RequestMeta } from '../../lib/request-meta';
import type { ActorContext } from '../../middleware/authenticate';
import type { ScopedClient } from '../../tenancy/scoped-client';
import { invalid, LIST_LIMIT, resolveBrandId, statusFilter } from '../menu/menu.common';

export interface InventoryDeps {
  prisma: PrismaClient;
  now: () => Date;
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (character) => `\\${character}`);

// What an order line stored about its choices (spec 005): only the ids matter here.
const lineDetailsSchema = z.object({
  modifiers: z.array(z.object({ id: z.string() })).default([]),
  choices: z
    .array(
      z.object({
        itemId: z.string(),
        modifiers: z.array(z.object({ id: z.string() })).default([]),
      }),
    )
    .default([]),
});
const mils = (value: Prisma.Decimal): number => toMils(value.toFixed(3));

export function toIngredient(row: IngredientRow): Ingredient {
  return {
    id: row.id,
    brandId: row.brandId,
    name: localizedTextSchema.parse(row.name),
    unit: row.unit,
    costPerUnit: row.costPerUnit.toFixed(3),
    lowLevel: row.lowLevel.toFixed(3),
    isActive: row.isActive,
  };
}

// The stock of an ingredient at a branch: low when at or below the branch's level, or the
// brand's default (rule 5); its value is quantity times cost (rule 6).
function toStock(branchId: string, ingredient: IngredientRow, stock: StockRow | null): BranchStock {
  const quantity = stock ? mils(stock.quantity) : 0;
  const level = stock?.lowLevel ? mils(stock.lowLevel) : mils(ingredient.lowLevel);
  return {
    branchId,
    ingredient: toIngredient(ingredient),
    quantity: fromMils(quantity),
    lowLevel: stock?.lowLevel ? stock.lowLevel.toFixed(3) : null,
    isLow: quantity <= level,
    value: fromMils(Math.round((quantity * mils(ingredient.costPerUnit)) / 1000)),
  };
}

function toMovement(row: MovementRow): StockMovement {
  return {
    id: row.id,
    branchId: row.branchId,
    ingredientId: row.ingredientId,
    kind: row.kind,
    quantity: row.quantity.toFixed(3),
    quantityAfter: row.quantityAfter.toFixed(3),
    note: row.note,
    referenceId: row.referenceId,
    byId: row.byId,
    byName: row.byName,
    createdAt: row.createdAt.toISOString(),
  };
}

// A brand's ingredients and the stock of each branch. See docs/specs/012-ingredients-and-stock.md.
export function createInventoryService({ prisma, now }: InventoryDeps) {
  const audit = (event: AuditEvent, meta: RequestMeta) =>
    writeAudit(prisma, { ...event, ip: meta.ip, userAgent: meta.userAgent });

  // An ingredient the person cannot see is answered like one that does not exist.
  async function loadIngredient({ db }: ActorContext, id: string): Promise<IngredientRow> {
    const row = await db.ingredient.findUnique({ where: { id } });
    if (!row) throw errors.notFound('Ingredient');
    return row;
  }

  // A branch the person works at (the scoped client hides the others).
  async function loadBranch(db: ScopedClient, id: string) {
    const branch = await db.branch.findUnique({ where: { id } });
    if (!branch) throw errors.notFound('Branch');
    return branch;
  }

  const nameOf = async (userId: string) =>
    (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? null;

  return {
    async listIngredients(
      { db }: ActorContext,
      query: IngredientListQuery,
    ): Promise<Page<Ingredient>> {
      const filters: Prisma.IngredientWhereInput[] = [];
      if (query.brandId) filters.push({ brandId: query.brandId });
      filters.push(statusFilter(query.status));
      // Every word typed has to be somewhere in a name, in either language (rule 8).
      for (const word of normalizeSearchText(query.q ?? '').split(' ')) {
        if (word) filters.push({ searchText: { contains: escapeLike(word) } });
      }
      const rows = await db.ingredient.findMany({
        where: { AND: filters },
        ...cursorPageArgs(LIST_LIMIT, undefined),
        orderBy: [{ searchText: 'asc' }, { id: 'asc' }],
      });
      return toPage(rows, LIST_LIMIT, toIngredient);
    },

    async createIngredient(
      ctx: ActorContext,
      input: CreateIngredientRequest,
      meta: RequestMeta,
    ): Promise<Ingredient> {
      const { auth, db } = ctx;
      const brandId = await resolveBrandId(ctx, input.brandId);
      const row = await db.ingredient.create({
        data: {
          brandId,
          name: input.name,
          searchText: searchTextOf(input.name),
          unit: input.unit,
          costPerUnit: input.costPerUnit,
          lowLevel: input.lowLevel,
          isActive: input.isActive,
        },
      });
      await audit(
        {
          action: 'ingredient.created',
          userId: auth.sub,
          brandId,
          entityType: 'ingredient',
          entityId: row.id,
          metadata: { name: input.name, unit: input.unit },
        },
        meta,
      );
      return toIngredient(row);
    },

    async updateIngredient(
      ctx: ActorContext,
      id: string,
      input: UpdateIngredientRequest,
      meta: RequestMeta,
    ): Promise<Ingredient> {
      const { auth, db } = ctx;
      const target = await loadIngredient(ctx, id);
      const data: Prisma.IngredientUpdateInput = {};
      const changed: string[] = [];

      if (input.name !== undefined && !isDeepStrictEqual(input.name, toIngredient(target).name)) {
        data.name = input.name;
        data.searchText = searchTextOf(input.name);
        changed.push('name');
      }
      if (input.unit !== undefined && input.unit !== target.unit) {
        // Old movements keep their meaning only while the unit stays (rule 1).
        const moved = await db.stockMovement.count({ where: { ingredientId: id } });
        if (moved > 0) throw invalid('unit', 'UNIT_LOCKED');
        data.unit = input.unit;
        changed.push('unit');
      }
      if (input.costPerUnit !== undefined && input.costPerUnit !== target.costPerUnit.toFixed(3)) {
        data.costPerUnit = input.costPerUnit;
        changed.push('costPerUnit');
      }
      if (input.lowLevel !== undefined && input.lowLevel !== target.lowLevel.toFixed(3)) {
        data.lowLevel = input.lowLevel;
        changed.push('lowLevel');
      }
      if (input.isActive !== undefined && input.isActive !== target.isActive) {
        data.isActive = input.isActive;
        changed.push('isActive');
      }
      if (changed.length === 0) return toIngredient(target);

      const updated = await db.ingredient.update({ where: { id }, data });
      await audit(
        {
          action: 'ingredient.updated',
          userId: auth.sub,
          brandId: target.brandId,
          entityType: 'ingredient',
          entityId: id,
          metadata: { changed },
        },
        meta,
      );
      return toIngredient(updated);
    },

    // The stock of a branch: every active ingredient of its brand, the low ones first.
    async listStock({ db }: ActorContext, query: StockListQuery): Promise<BranchStock[]> {
      const branch = await loadBranch(db, query.branchId);
      const ingredients = await db.ingredient.findMany({
        where: { brandId: branch.brandId, isActive: true },
        orderBy: [{ searchText: 'asc' }, { id: 'asc' }],
        take: LIST_LIMIT,
      });
      const stocks = await db.branchStock.findMany({ where: { branchId: branch.id } });
      const stockOf = new Map(stocks.map((stock) => [stock.ingredientId, stock]));

      const rows = ingredients.map((ingredient) =>
        toStock(branch.id, ingredient, stockOf.get(ingredient.id) ?? null),
      );
      const shown = query.low ? rows.filter((row) => row.isLow) : rows;
      return shown.sort((a, b) => Number(b.isLow) - Number(a.isLow));
    },

    // The ingredients that are out or low at each branch the person sees, worked out from the
    // stock each time (spec 016). A level of 0 means the ingredient is not watched (rule 1).
    async alerts({ db }: ActorContext, query: StockAlertsQuery): Promise<BranchStockAlerts[]> {
      const branches = await db.branch.findMany({
        where: { isActive: true, ...(query.brandId ? { brandId: query.brandId } : {}) },
      });
      if (branches.length === 0) return [];
      const ingredients = await db.ingredient.findMany({
        where: {
          brandId: { in: [...new Set(branches.map((row) => row.brandId))] },
          isActive: true,
        },
      });
      const stocks = await db.branchStock.findMany({
        where: { branchId: { in: branches.map((row) => row.id) } },
      });
      const stockOf = new Map(stocks.map((row) => [`${row.branchId}:${row.ingredientId}`, row]));

      const result = branches.flatMap((branch) => {
        const items = ingredients
          .filter((ingredient) => ingredient.brandId === branch.brandId)
          .flatMap((ingredient) => {
            const stock = stockOf.get(`${branch.id}:${ingredient.id}`);
            const level = stock?.lowLevel ? mils(stock.lowLevel) : mils(ingredient.lowLevel);
            const quantity = stock ? mils(stock.quantity) : 0;
            if (level <= 0 || quantity > level) return [];
            return [{ ingredient, quantity, level }];
          })
          // Out first, then furthest below the level, then by name (rule 3).
          .sort(
            (a, b) =>
              Number(b.quantity <= 0) - Number(a.quantity <= 0) ||
              a.quantity / a.level - b.quantity / b.level ||
              a.ingredient.searchText.localeCompare(b.ingredient.searchText),
          )
          .map(({ ingredient, quantity, level }) => ({
            ingredient: toIngredient(ingredient),
            quantity: fromMils(quantity),
            level: fromMils(level),
            status: quantity <= 0 ? ('out' as const) : ('low' as const),
          }));
        if (items.length === 0) return [];
        const name = localizedTextSchema.parse(branch.name);
        return [{ branch: { id: branch.id, brandId: branch.brandId, name }, items }];
      });
      const outs = (alerts: BranchStockAlerts) =>
        alerts.items.filter((item) => item.status === 'out').length;
      return result.sort(
        (a, b) => outs(b) - outs(a) || a.branch.name.en.localeCompare(b.branch.name.en),
      );
    },

    async setLowLevel(
      ctx: ActorContext,
      branchId: string,
      ingredientId: string,
      input: SetLowLevelRequest,
    ): Promise<BranchStock> {
      const { db } = ctx;
      const branch = await loadBranch(db, branchId);
      const ingredient = await loadIngredient(ctx, ingredientId);
      if (ingredient.brandId !== branch.brandId) throw errors.notFound('Ingredient');

      const where = { branchId_ingredientId: { branchId, ingredientId } };
      const stock = await db.branchStock.upsert({
        where,
        create: { branchId, ingredientId, brandId: branch.brandId, lowLevel: input.lowLevel },
        update: { lowLevel: input.lowLevel },
      });
      return toStock(branchId, ingredient, stock);
    },

    // A movement recorded by hand, written with the new quantity in one transaction (rules 3
    // and 4).
    async recordMovement(ctx: ActorContext, input: CreateMovementRequest): Promise<BranchStock> {
      const { auth, db } = ctx;
      const branch = await loadBranch(db, input.branchId);
      const ingredient = await db.ingredient.findUnique({ where: { id: input.ingredientId } });
      if (!ingredient || ingredient.brandId !== branch.brandId || !ingredient.isActive) {
        throw invalid('ingredientId', 'INGREDIENT_NOT_FOUND');
      }
      const byName = await nameOf(auth.sub);

      const stock = await db.$transaction(async (tx) => {
        const where = {
          branchId_ingredientId: { branchId: branch.id, ingredientId: ingredient.id },
        };
        // The row is created on the first movement; raising nothing but reading it inside the
        // transaction keeps two movements at the same moment in order.
        const current = await tx.branchStock.upsert({
          where,
          create: { branchId: branch.id, ingredientId: ingredient.id, brandId: branch.brandId },
          update: {},
        });
        const before = mils(current.quantity);
        const delta =
          input.kind === 'received'
            ? toMils(input.quantity)
            : input.kind === 'waste'
              ? -toMils(input.quantity)
              : toMils(input.quantity) - before;
        const after = before + delta;
        if (after < 0) throw invalid('quantity', 'STOCK_NEGATIVE');

        await tx.stockMovement.create({
          data: {
            brandId: branch.brandId,
            branchId: branch.id,
            ingredientId: ingredient.id,
            kind: input.kind,
            quantity: fromMils(delta),
            quantityAfter: fromMils(after),
            note: input.note ?? null,
            byId: auth.sub,
            byName,
            createdAt: now(),
          },
        });
        return tx.branchStock.update({ where, data: { quantity: fromMils(after) } });
      });
      return toStock(branch.id, ingredient, stock);
    },

    // Takes the ingredients of an order's lines off the branch's stock when it is paid, as one
    // "sold" movement per ingredient that names the order. A dish without a recipe takes nothing
    // off, and a sale may take the stock below zero. See docs/specs/013-recipes.md, rules 3 to 5.
    async sellForOrder(
      tx: Pick<ScopedClient, 'recipeLine' | 'branchStock' | 'stockMovement'>,
      order: { id: string; number: number; brandId: string; branchId: string },
      lines: { itemId: string | null; quantity: number; status: string; details: unknown }[],
      by: { id: string; name: string | null },
      at: Date,
    ): Promise<void> {
      const itemQuantity = new Map<string, number>();
      const modifierQuantity = new Map<string, number>();
      const add = (map: Map<string, number>, key: string, quantity: number) =>
        map.set(key, (map.get(key) ?? 0) + quantity);

      for (const line of lines) {
        if (line.status === 'voided') continue;
        const details = lineDetailsSchema.safeParse(line.details);
        const modifiers = details.success ? details.data.modifiers : [];
        const choices = details.success ? details.data.choices : [];
        if (line.itemId) add(itemQuantity, line.itemId, line.quantity);
        for (const modifier of modifiers) add(modifierQuantity, modifier.id, line.quantity);
        // A combo uses the recipes of the dishes chosen for its slots (rule 2).
        for (const choice of choices) {
          add(itemQuantity, choice.itemId, line.quantity);
          for (const modifier of choice.modifiers) {
            add(modifierQuantity, modifier.id, line.quantity);
          }
        }
      }
      if (itemQuantity.size === 0 && modifierQuantity.size === 0) return;

      const recipes = await tx.recipeLine.findMany({
        where: {
          OR: [
            { itemId: { in: [...itemQuantity.keys()] } },
            { modifierId: { in: [...modifierQuantity.keys()] } },
          ],
        },
      });
      const used = new Map<string, number>();
      for (const recipe of recipes) {
        const times =
          (recipe.itemId ? itemQuantity.get(recipe.itemId) : undefined) ??
          (recipe.modifierId ? modifierQuantity.get(recipe.modifierId) : undefined) ??
          0;
        if (times > 0) add(used, recipe.ingredientId, mils(recipe.quantity) * times);
      }
      if (used.size === 0) return;

      for (const [ingredientId, quantity] of used) {
        const where = { branchId_ingredientId: { branchId: order.branchId, ingredientId } };
        const current = await tx.branchStock.upsert({
          where,
          create: { branchId: order.branchId, ingredientId, brandId: order.brandId },
          update: {},
        });
        const after = mils(current.quantity) - quantity;
        await tx.stockMovement.create({
          data: {
            brandId: order.brandId,
            branchId: order.branchId,
            ingredientId,
            kind: 'sold',
            quantity: fromMils(-quantity),
            quantityAfter: fromMils(after),
            note: `Order ${order.number}`,
            referenceId: order.id,
            byId: by.id,
            byName: by.name,
            createdAt: at,
          },
        });
        await tx.branchStock.update({ where, data: { quantity: fromMils(after) } });
      }
    },

    async listMovements(
      { db }: ActorContext,
      query: MovementListQuery,
    ): Promise<Page<StockMovement>> {
      await loadBranch(db, query.branchId);
      const rows = await db.stockMovement.findMany({
        where: {
          branchId: query.branchId,
          ...(query.ingredientId ? { ingredientId: query.ingredientId } : {}),
        },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const page = splitPage(rows, query.limit);
      return { data: page.rows.map(toMovement), nextCursor: page.nextCursor };
    },
  };
}

export type InventoryService = ReturnType<typeof createInventoryService>;
