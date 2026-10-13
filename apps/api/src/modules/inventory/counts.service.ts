import {
  type CancelCountRequest,
  type CountListQuery,
  fromMils,
  MAX_COUNT_LINES,
  type Page,
  type SaveCountLinesRequest,
  type StartCountRequest,
  type StockCount,
  type StockCountSummary,
  toMils,
} from '@pos/shared';
import type {
  Ingredient as IngredientRow,
  Prisma,
  StockCount as CountRow,
  StockCountLine as LineRow,
} from '../../generated/prisma/client';
import { type AuditEvent, writeAudit } from '../../lib/audit';
import { errors } from '../../lib/http-errors';
import { splitPage } from '../../lib/pagination';
import type { PrismaClient } from '../../lib/prisma';
import type { RequestMeta } from '../../lib/request-meta';
import type { ActorContext } from '../../middleware/authenticate';
import type { ScopedClient } from '../../tenancy/scoped-client';
import { invalid } from '../menu/menu.common';
import { isUniqueViolation } from '../orders/orders.common';
import { toIngredient } from './inventory.service';

export interface CountsDeps {
  prisma: PrismaClient;
  now: () => Date;
}

const mils = (value: Prisma.Decimal): number => toMils(value.toFixed(3));
const iso = (value: Date | null) => (value ? value.toISOString() : null);

const notOpen = () => errors.conflict('COUNT_NOT_OPEN', 'This count was finished or cancelled');
const alreadyOpen = () =>
  errors.conflict('COUNT_ALREADY_OPEN', 'A count is already open at this branch');

// The difference of a counted line and its value, in mils: counted minus expected, times the
// cost of a unit (the one kept at finishing, or the ingredient's current one while open).
function differenceOf(line: LineRow, ingredient: IngredientRow | undefined) {
  if (!line.counted) return null;
  const difference = mils(line.counted) - mils(line.expected);
  const cost = line.unitCost ? mils(line.unitCost) : ingredient ? mils(ingredient.costPerUnit) : 0;
  return { difference, value: Math.round((difference * cost) / 1000) };
}

function summaryOf(
  row: CountRow,
  lines: LineRow[],
  ingredientOf: ReadonlyMap<string, IngredientRow>,
): StockCountSummary {
  let lost = 0;
  let found = 0;
  let counted = 0;
  for (const line of lines) {
    const result = differenceOf(line, ingredientOf.get(line.ingredientId));
    if (!result) continue;
    counted += 1;
    if (result.value < 0) lost += result.value;
    else found += result.value;
  }
  return {
    id: row.id,
    number: row.number,
    branchId: row.branchId,
    status: row.status,
    note: row.note,
    lineCount: lines.length,
    countedCount: counted,
    lostValue: fromMils(lost),
    foundValue: fromMils(found),
    startedByName: row.startedByName,
    startedAt: row.startedAt.toISOString(),
    finishedByName: row.finishedByName,
    finishedAt: iso(row.finishedAt),
    cancelledByName: row.cancelledByName,
    cancelledAt: iso(row.cancelledAt),
    cancelReason: row.cancelReason,
  };
}

// Checking a branch's stock against the shelves. See docs/specs/015-stock-counts.md.
export function createCountsService({ prisma, now }: CountsDeps) {
  const audit = (event: AuditEvent, meta: RequestMeta) =>
    writeAudit(prisma, { ...event, ip: meta.ip, userAgent: meta.userAgent });

  const nameOf = async (userId: string) =>
    (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? null;

  // A branch, or a count, the person cannot see is answered like one that does not exist.
  async function loadBranch(db: ScopedClient, id: string) {
    const branch = await db.branch.findUnique({ where: { id } });
    if (!branch) throw errors.notFound('Branch');
    return branch;
  }

  async function loadCount(db: ScopedClient, id: string): Promise<CountRow> {
    const row = await db.stockCount.findUnique({ where: { id } });
    if (!row) throw errors.notFound('Count');
    return row;
  }

  async function ingredientsOf(db: ScopedClient, lines: LineRow[]) {
    const rows = await db.ingredient.findMany({
      where: { id: { in: [...new Set(lines.map((line) => line.ingredientId))] } },
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

  async function describe(db: ScopedClient, row: CountRow): Promise<StockCount> {
    const lines = await db.stockCountLine.findMany({ where: { countId: row.id } });
    const ingredientOf = await ingredientsOf(db, lines);
    const name = (line: LineRow) => ingredientOf.get(line.ingredientId)?.searchText ?? '';
    const sorted = [...lines].sort((a, b) => name(a).localeCompare(name(b)));
    return {
      ...summaryOf(row, lines, ingredientOf),
      lines: sorted.flatMap((line) => {
        const ingredient = ingredientOf.get(line.ingredientId);
        if (!ingredient) return [];
        const result = differenceOf(line, ingredient);
        return [
          {
            ingredient: toIngredient(ingredient),
            expected: line.expected.toFixed(3),
            counted: line.counted?.toFixed(3) ?? null,
            difference: result ? fromMils(result.difference) : null,
            value: result ? fromMils(result.value) : null,
          },
        ];
      }),
    };
  }

  return {
    // The counts of a branch, open first, then newest first.
    async list({ db }: ActorContext, query: CountListQuery): Promise<Page<StockCountSummary>> {
      await loadBranch(db, query.branchId);
      const rows = await db.stockCount.findMany({
        where: { branchId: query.branchId, ...(query.status ? { status: query.status } : {}) },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        // Only the open count has an open key, so it comes first.
        orderBy: [
          { openKey: { sort: 'asc', nulls: 'last' } },
          { startedAt: 'desc' },
          { id: 'desc' },
        ],
      });
      const page = splitPage(rows, query.limit);
      const lines = await db.stockCountLine.findMany({
        where: { countId: { in: page.rows.map((row) => row.id) } },
      });
      const ingredientOf = await ingredientsOf(db, lines);
      return {
        data: page.rows.map((row) =>
          summaryOf(
            row,
            lines.filter((line) => line.countId === row.id),
            ingredientOf,
          ),
        ),
        nextCursor: page.nextCursor,
      };
    },

    async get({ db }: ActorContext, id: string): Promise<StockCount> {
      return describe(db, await loadCount(db, id));
    },

    // Starts a count of the chosen ingredients, or of all of them (rules 1 and 2).
    async start(
      ctx: ActorContext,
      input: StartCountRequest,
      meta: RequestMeta,
    ): Promise<StockCount> {
      const { auth, db } = ctx;
      const branch = await loadBranch(db, input.branchId);
      if (!branch.isActive) throw errors.branchInactive();
      const open = await db.stockCount.findFirst({
        where: { branchId: branch.id, status: 'open' },
      });
      if (open) throw alreadyOpen();

      let ingredients: IngredientRow[];
      if (input.ingredientIds) {
        ingredients = await db.ingredient.findMany({
          where: { id: { in: input.ingredientIds }, brandId: branch.brandId, isActive: true },
        });
        const known = new Set(ingredients.map((ingredient) => ingredient.id));
        const missing = input.ingredientIds.findIndex((id) => !known.has(id));
        if (missing >= 0) throw invalid(`ingredientIds.${missing}`, 'INGREDIENT_NOT_FOUND');
      } else {
        ingredients = await db.ingredient.findMany({
          where: { brandId: branch.brandId, isActive: true },
          take: MAX_COUNT_LINES + 1,
        });
        if (ingredients.length > MAX_COUNT_LINES) throw invalid('ingredientIds', 'COUNT_TOO_LONG');
      }
      if (ingredients.length === 0) throw invalid('ingredientIds', 'INGREDIENT_REQUIRED');

      const stocks = await db.branchStock.findMany({
        where: { branchId: branch.id, ingredientId: { in: ingredients.map((row) => row.id) } },
      });
      const stockOf = new Map(stocks.map((stock) => [stock.ingredientId, stock.quantity]));
      const byName = await nameOf(auth.sub);

      let row: CountRow;
      try {
        row = await db.$transaction(async (tx) => {
          const count = await tx.stockCount.create({
            data: {
              brandId: branch.brandId,
              branchId: branch.id,
              openKey: branch.id,
              note: input.note ?? null,
              startedById: auth.sub,
              startedByName: byName,
              startedAt: now(),
            },
          });
          await tx.stockCountLine.createMany({
            data: ingredients.map((ingredient) => ({
              countId: count.id,
              brandId: branch.brandId,
              branchId: branch.id,
              ingredientId: ingredient.id,
              expected: stockOf.get(ingredient.id)?.toFixed(3) ?? '0.000',
            })),
          });
          return count;
        });
      } catch (error) {
        // Two people starting a count at the same moment: the open key lets one through.
        if (isUniqueViolation(error)) throw alreadyOpen();
        throw error;
      }
      await audit(
        {
          action: 'inventory.count.started',
          userId: auth.sub,
          brandId: branch.brandId,
          branchId: branch.id,
          entityType: 'stock_count',
          entityId: row.id,
          metadata: { number: row.number, lines: ingredients.length },
        },
        meta,
      );
      return describe(db, row);
    },

    // Saves what was typed on some lines (rule 3).
    async saveLines(
      { db }: ActorContext,
      id: string,
      input: SaveCountLinesRequest,
    ): Promise<StockCount> {
      const count = await loadCount(db, id);
      if (count.status !== 'open') throw notOpen();
      const lines = await db.stockCountLine.findMany({ where: { countId: id } });
      const onCount = new Set(lines.map((line) => line.ingredientId));
      const missing = input.lines.findIndex((line) => !onCount.has(line.ingredientId));
      if (missing >= 0) throw invalid(`lines.${missing}.ingredientId`, 'INGREDIENT_NOT_FOUND');

      await db.$transaction(async (tx) => {
        const still = await tx.stockCount.findUnique({ where: { id } });
        if (still?.status !== 'open') throw notOpen();
        for (const line of input.lines) {
          await tx.stockCountLine.updateMany({
            where: { countId: id, ingredientId: line.ingredientId },
            data: { counted: line.counted },
          });
        }
      });
      return describe(db, count);
    },

    // Sets the stock to what was counted, against the stock at this moment (rules 4 and 5).
    async finish(ctx: ActorContext, id: string, meta: RequestMeta): Promise<StockCount> {
      const { auth, db } = ctx;
      const count = await loadCount(db, id);
      if (count.status !== 'open') throw notOpen();
      const by = { id: auth.sub, name: await nameOf(auth.sub) };
      const at = now();

      const row = await db.$transaction(async (tx) => {
        const changed = await tx.stockCount.updateMany({
          where: { id, status: 'open' },
          data: {
            status: 'finished',
            openKey: null,
            finishedById: by.id,
            finishedByName: by.name,
            finishedAt: at,
          },
        });
        if (changed.count === 0) throw notOpen();
        const lines = await tx.stockCountLine.findMany({ where: { countId: id } });
        const counted = lines.filter((line) => line.counted !== null);
        if (counted.length === 0) {
          throw errors.conflict('COUNT_EMPTY', 'Nothing was counted yet');
        }
        const ingredients = await tx.ingredient.findMany({
          where: { id: { in: counted.map((line) => line.ingredientId) } },
        });
        const costOf = new Map(ingredients.map((row) => [row.id, row.costPerUnit]));

        for (const line of counted) {
          const target = mils(line.counted as Prisma.Decimal);
          const where = {
            branchId_ingredientId: { branchId: count.branchId, ingredientId: line.ingredientId },
          };
          const stock = await tx.branchStock.upsert({
            where,
            create: {
              branchId: count.branchId,
              ingredientId: line.ingredientId,
              brandId: count.brandId,
            },
            update: {},
          });
          const before = mils(stock.quantity);
          await tx.stockCountLine.update({
            where: { id: line.id },
            data: {
              expected: fromMils(before),
              unitCost: costOf.get(line.ingredientId)?.toFixed(3) ?? '0.000',
            },
          });
          if (target === before) continue;
          await tx.stockMovement.create({
            data: {
              brandId: count.brandId,
              branchId: count.branchId,
              ingredientId: line.ingredientId,
              kind: 'count',
              quantity: fromMils(target - before),
              quantityAfter: fromMils(target),
              note: `Count ${count.number}`,
              referenceId: id,
              byId: by.id,
              byName: by.name,
              createdAt: at,
            },
          });
          await tx.branchStock.update({ where, data: { quantity: fromMils(target) } });
        }
        return tx.stockCount.findUniqueOrThrow({ where: { id } });
      });

      const result = await describe(db, row);
      await audit(
        {
          action: 'inventory.count.finished',
          userId: auth.sub,
          brandId: count.brandId,
          branchId: count.branchId,
          entityType: 'stock_count',
          entityId: id,
          metadata: {
            number: count.number,
            counted: result.countedCount,
            lostValue: result.lostValue,
            foundValue: result.foundValue,
          },
        },
        meta,
      );
      return result;
    },

    // Cancels an open count; the stock stays as it is (rule 6).
    async cancel(
      ctx: ActorContext,
      id: string,
      input: CancelCountRequest,
      meta: RequestMeta,
    ): Promise<StockCount> {
      const { auth, db } = ctx;
      const count = await loadCount(db, id);
      if (count.status !== 'open') throw notOpen();
      const byName = await nameOf(auth.sub);
      const changed = await db.stockCount.updateMany({
        where: { id, status: 'open' },
        data: {
          status: 'cancelled',
          openKey: null,
          cancelledById: auth.sub,
          cancelledByName: byName,
          cancelledAt: now(),
          cancelReason: input.reason,
        },
      });
      if (changed.count === 0) throw notOpen();
      await audit(
        {
          action: 'inventory.count.cancelled',
          userId: auth.sub,
          brandId: count.brandId,
          branchId: count.branchId,
          entityType: 'stock_count',
          entityId: id,
          metadata: { number: count.number, reason: input.reason },
        },
        meta,
      );
      return describe(db, await loadCount(db, id));
    },
  };
}

export type CountsService = ReturnType<typeof createCountsService>;
