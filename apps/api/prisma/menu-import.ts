import {
  localizedNameSchema,
  localizedTextSchema,
  priceChangeSchema,
  priceSchema,
  searchTextOf,
} from '@pos/shared';
import { z } from 'zod';
import { Prisma } from '../src/generated/prisma/client';
import type { PrismaClient } from '../src/lib/prisma';

// A menu to import for a brand, as prisma/menus/*.json holds it (docs/rollout.md). Items of a
// category, with a price and a photo link; the groups of extras and choices an item offers are
// named once under "modifierGroups" and listed on each item that has them.

const modifierGroupSchema = z.strictObject({
  name: localizedNameSchema,
  minSelect: z.number().int().min(0).default(0),
  maxSelect: z.number().int().min(1).default(1),
  modifiers: z
    .array(
      z.strictObject({ name: localizedNameSchema, priceDelta: priceChangeSchema.default('0.000') }),
    )
    .min(1),
});

export const menuImportSchema = z.strictObject({
  $comment: z.string().optional(),
  categories: z
    .array(
      z.strictObject({
        name: localizedNameSchema,
        items: z.array(
          z.strictObject({
            name: localizedNameSchema,
            description: localizedTextSchema.optional(),
            price: priceSchema,
            imageUrl: z.url().optional(),
            modifierGroups: z.array(z.string()).default([]),
          }),
        ),
      }),
    )
    .min(1),
  modifierGroups: z.record(z.string(), modifierGroupSchema).default({}),
});
export type MenuImport = z.infer<typeof menuImportSchema>;

export interface ImportCounts {
  categories: number;
  items: number;
  groups: number;
  modifiers: number;
}

const keyOf = (name: { en: string }) => name.en.trim().toLowerCase();

// Writes the menu into the brand. Categories, items, groups and modifiers are matched by their
// English name, so running it again updates prices and texts and never makes copies. What is in
// the brand's menu but not in the file is left as it is.
export async function importMenu(
  prisma: PrismaClient,
  brandId: string,
  input: unknown,
): Promise<ImportCounts> {
  const menu = menuImportSchema.parse(input);
  for (const category of menu.categories) {
    for (const item of category.items) {
      for (const key of item.modifierGroups) {
        if (!menu.modifierGroups[key]) {
          throw new Error(
            `Item "${item.name.en}" names a modifier group "${key}" that is not defined.`,
          );
        }
      }
    }
  }

  const counts: ImportCounts = { categories: 0, items: 0, groups: 0, modifiers: 0 };
  const existingCategories = await prisma.menuCategory.findMany({ where: { brandId } });
  const categoryByKey = new Map(
    existingCategories.map((row) => [keyOf(localizedNameSchema.parse(row.name)), row]),
  );
  const lastSort = existingCategories.reduce((max, row) => Math.max(max, row.sortOrder), -1);

  for (const [index, category] of menu.categories.entries()) {
    const found = categoryByKey.get(keyOf(category.name));
    const categoryRow = found
      ? await prisma.menuCategory.update({
          where: { id: found.id },
          data: { name: category.name },
        })
      : await prisma.menuCategory.create({
          data: { brandId, name: category.name, sortOrder: lastSort + 1 + index, isActive: true },
        });
    counts.categories += 1;

    const existingItems = await prisma.menuItem.findMany({
      where: { brandId, categoryId: categoryRow.id },
    });
    const itemByKey = new Map(
      existingItems.map((row) => [keyOf(localizedNameSchema.parse(row.name)), row]),
    );
    for (const item of category.items) {
      const data = {
        name: item.name,
        description: item.description ?? Prisma.DbNull,
        searchText: searchTextOf(item.name),
        basePrice: item.price,
        imageUrl: item.imageUrl ?? null,
      };
      const foundItem = itemByKey.get(keyOf(item.name));
      const itemRow = foundItem
        ? await prisma.menuItem.update({ where: { id: foundItem.id }, data })
        : await prisma.menuItem.create({
            data: { ...data, brandId, categoryId: categoryRow.id, isActive: true },
          });
      counts.items += 1;

      const existingGroups = await prisma.modifierGroup.findMany({ where: { itemId: itemRow.id } });
      const groupByKey = new Map(
        existingGroups.map((row) => [keyOf(localizedNameSchema.parse(row.name)), row]),
      );
      for (const [order, key] of item.modifierGroups.entries()) {
        const group = menu.modifierGroups[key];
        if (!group) continue;
        const groupData = {
          name: group.name,
          minSelect: group.minSelect,
          maxSelect: Math.max(group.maxSelect, group.minSelect),
          sortOrder: order,
          isActive: true,
        };
        const foundGroup = groupByKey.get(keyOf(group.name));
        const groupRow = foundGroup
          ? await prisma.modifierGroup.update({ where: { id: foundGroup.id }, data: groupData })
          : await prisma.modifierGroup.create({
              data: { ...groupData, brandId, itemId: itemRow.id },
            });
        counts.groups += 1;

        const existingModifiers = await prisma.modifier.findMany({
          where: { groupId: groupRow.id },
        });
        const modifierByKey = new Map(
          existingModifiers.map((row) => [keyOf(localizedNameSchema.parse(row.name)), row]),
        );
        for (const [position, modifier] of group.modifiers.entries()) {
          const modifierData = {
            name: modifier.name,
            priceDelta: modifier.priceDelta,
            sortOrder: position,
            isActive: true,
          };
          const foundModifier = modifierByKey.get(keyOf(modifier.name));
          if (foundModifier) {
            await prisma.modifier.update({ where: { id: foundModifier.id }, data: modifierData });
          } else {
            await prisma.modifier.create({
              data: { ...modifierData, brandId, groupId: groupRow.id },
            });
          }
          counts.modifiers += 1;
        }
      }
    }
  }
  return counts;
}
