import {
  fromMils,
  localizedTextSchema,
  type PutRecipeRequest,
  type Recipe,
  type RecipeLine,
  toMils,
} from '@pos/shared';
import type {
  Ingredient as IngredientRow,
  Prisma,
  RecipeLine as LineRow,
} from '../../generated/prisma/client';
import { errors } from '../../lib/http-errors';
import type { ActorContext } from '../../middleware/authenticate';
import type { ScopedClient } from '../../tenancy/scoped-client';
import { invalid, type MenuDeps } from './menu.common';

// The dish or the modifier a recipe belongs to.
export type RecipeOwner = { itemId: string } | { modifierId: string };

const mils = (value: Prisma.Decimal): number => toMils(value.toFixed(3));

function toLine(row: LineRow, ingredient: IngredientRow): RecipeLine {
  const quantity = mils(row.quantity);
  return {
    ingredient: {
      id: ingredient.id,
      brandId: ingredient.brandId,
      name: localizedTextSchema.parse(ingredient.name),
      unit: ingredient.unit,
      costPerUnit: ingredient.costPerUnit.toFixed(3),
      lowLevel: ingredient.lowLevel.toFixed(3),
      isActive: ingredient.isActive,
    },
    quantity: fromMils(quantity),
    cost: fromMils(Math.round((quantity * mils(ingredient.costPerUnit)) / 1000)),
  };
}

// What a dish or a modifier uses. See docs/specs/013-recipes.md.
export function createRecipesService({ audit }: MenuDeps) {
  // The brand of the owner; an owner the person cannot see is answered like one that does not
  // exist.
  async function brandOf(db: ScopedClient, owner: RecipeOwner): Promise<string> {
    if ('itemId' in owner) {
      const item = await db.menuItem.findUnique({ where: { id: owner.itemId } });
      if (!item) throw errors.notFound('Menu item');
      return item.brandId;
    }
    const modifier = await db.modifier.findUnique({ where: { id: owner.modifierId } });
    if (!modifier) throw errors.notFound('Modifier');
    return modifier.brandId;
  }

  async function describe(db: ScopedClient, owner: RecipeOwner): Promise<Recipe> {
    const rows = await db.recipeLine.findMany({ where: owner, orderBy: { id: 'asc' } });
    const ingredients = await db.ingredient.findMany({
      where: { id: { in: rows.map((row) => row.ingredientId) } },
    });
    const ingredientOf = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
    const lines = rows.flatMap((row) => {
      const ingredient = ingredientOf.get(row.ingredientId);
      return ingredient ? [toLine(row, ingredient)] : [];
    });
    return {
      lines,
      cost: fromMils(lines.reduce((sum, line) => sum + toMils(line.cost), 0)),
    };
  }

  return {
    async get(ctx: ActorContext, owner: RecipeOwner): Promise<Recipe> {
      await brandOf(ctx.db, owner);
      return describe(ctx.db, owner);
    },

    // Replaces the recipe as a whole (rule 1).
    async put(
      ctx: ActorContext,
      owner: RecipeOwner,
      input: PutRecipeRequest,
      meta: Parameters<MenuDeps['audit']>[1],
    ): Promise<Recipe> {
      const { auth, db } = ctx;
      const brandId = await brandOf(db, owner);

      const ingredients = await db.ingredient.findMany({
        where: { id: { in: input.lines.map((line) => line.ingredientId) }, brandId },
      });
      const known = new Set(ingredients.map((ingredient) => ingredient.id));
      const missing = input.lines.findIndex((line) => !known.has(line.ingredientId));
      if (missing >= 0) throw invalid(`lines.${missing}.ingredientId`, 'INGREDIENT_NOT_FOUND');

      await db.$transaction(async (tx) => {
        await tx.recipeLine.deleteMany({ where: owner });
        if (input.lines.length > 0) {
          await tx.recipeLine.createMany({
            data: input.lines.map((line) => ({
              brandId,
              ...owner,
              ingredientId: line.ingredientId,
              quantity: line.quantity,
            })),
          });
        }
      });
      await audit(
        {
          action: 'menu.recipe.updated',
          userId: auth.sub,
          brandId,
          entityType: 'itemId' in owner ? 'menu_item' : 'modifier',
          entityId: 'itemId' in owner ? owner.itemId : owner.modifierId,
          metadata: { lines: input.lines.length },
        },
        meta,
      );
      return describe(db, owner);
    },
  };
}

export type RecipesService = ReturnType<typeof createRecipesService>;
