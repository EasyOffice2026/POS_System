import { writeAudit } from '../../lib/audit';
import type { MenuCache } from '../../lib/menu-cache';
import type { PrismaClient } from '../../lib/prisma';
import { createBranchMenuService } from './branch-menu.service';
import { createCategoriesService } from './categories.service';
import { createCombosService } from './combos.service';
import { createItemsService } from './items.service';
import type { MenuDeps } from './menu.common';
import { createModifiersService } from './modifiers.service';
import { createRecipesService } from './recipes.service';

export interface MenuServiceDeps {
  prisma: PrismaClient;
  cache: MenuCache;
}

// The menu: categories, items with what each branch changes about them, modifiers, combos, and
// the menu of one branch as its terminal loads it. See docs/specs/004-menu.md.
export function createMenuService({ prisma, cache }: MenuServiceDeps) {
  const deps: MenuDeps = {
    prisma,
    cache,
    audit: (event, meta) =>
      writeAudit(prisma, { ...event, ip: meta.ip, userAgent: meta.userAgent }),
  };

  return {
    categories: createCategoriesService(deps),
    items: createItemsService(deps),
    modifiers: createModifiersService(deps),
    recipes: createRecipesService(deps),
    combos: createCombosService(deps),
    branchMenu: createBranchMenuService(deps),
  };
}

export type MenuService = ReturnType<typeof createMenuService>;
