import {
  branchMenuSchema,
  branchOverrideSchema,
  type createComboRequestSchema,
  type createItemRequestSchema,
  type createModifierGroupRequestSchema,
  type createModifierRequestSchema,
  comboSchema,
  type MenuStatus,
  menuCategorySchema,
  menuItemDetailSchema,
  menuItemSchema,
  modifierGroupSchema,
  modifierSchema,
  pageSchema,
  promotionSchema,
  type putBranchOverrideRequestSchema,
  type PutRecipeRequest,
  recipeSchema,
  type UpdateCategoryRequest,
  type UpdateComboRequest,
  type UpdateItemRequest,
  type UpdateModifierGroupRequest,
  type UpdateModifierRequest,
  type updatePromotionRequestSchema,
} from '@pos/shared';
import { z } from 'zod';
import { request } from '../../lib/api';
import { queryString } from '../../lib/query-string';

// The requests before the server applies defaults, so callers can leave out fields that have one.
export type CreateItemInput = z.input<typeof createItemRequestSchema>;
export type CreateModifierGroupInput = z.input<typeof createModifierGroupRequestSchema>;
export type CreateModifierInput = z.input<typeof createModifierRequestSchema>;
export type CreateComboInput = z.input<typeof createComboRequestSchema>;
export type PutBranchOverrideInput = z.input<typeof putBranchOverrideRequestSchema>;

const listOf = <Schema extends z.ZodType>(item: Schema) => z.object({ data: z.array(item) });

// The keys of what the menu screens have loaded. Everything starts with "menu", so one call can
// load all of it again.
export const menuKeys = {
  all: ['menu'] as const,
  categories: (brandId: string) => ['menu', brandId, 'categories'] as const,
  items: (filters: ItemFilters) => ['menu', filters.brandId, 'items', filters] as const,
  allItems: (brandId: string) => ['menu', brandId, 'all-items'] as const,
  item: (id: string) => ['menu', 'item', id] as const,
  overrides: (itemId: string) => ['menu', 'item', itemId, 'overrides'] as const,
  combos: (brandId: string) => ['menu', brandId, 'combos'] as const,
  combo: (id: string) => ['menu', 'combo', id] as const,
  branchMenu: (branchId: string) => ['menu', 'branch', branchId] as const,
  recipe: (owner: RecipeOwner) =>
    ['menu', 'recipe', 'itemId' in owner ? owner.itemId : owner.modifierId] as const,
};

// ---- categories

export async function listCategories(brandId: string) {
  const { data } = await request(`/menu/categories${queryString({ brandId })}`, {
    schema: listOf(menuCategorySchema),
  });
  return data;
}

export const createCategory = (body: { brandId: string; name: { en: string; ar: string } }) =>
  request('/menu/categories', { method: 'POST', body, schema: menuCategorySchema });

export const updateCategory = (id: string, body: UpdateCategoryRequest) =>
  request(`/menu/categories/${id}`, { method: 'PATCH', body, schema: menuCategorySchema });

// All the categories of the brand, first to last. The answer is the list in the new order.
export async function reorderCategories(brandId: string, ids: string[]) {
  const { data } = await request('/menu/categories/order', {
    method: 'PUT',
    body: { brandId, ids },
    schema: listOf(menuCategorySchema),
  });
  return data;
}

// ---- items

export interface ItemFilters {
  brandId: string;
  categoryId?: string;
  status?: MenuStatus;
  q?: string;
}

const PAGE_SIZE = 25;
const ALL_PAGE_SIZE = 100;
const itemPage = pageSchema(menuItemSchema);

export const listItemsPage = (filters: ItemFilters, cursor?: string) =>
  request(`/menu/items${queryString({ ...filters, limit: PAGE_SIZE, cursor })}`, {
    schema: itemPage,
  });

// Every item of the brand, for the pickers of a combo.
export async function listAllItems(brandId: string) {
  const items: z.output<typeof menuItemSchema>[] = [];
  let cursor: string | undefined;

  do {
    const page: z.output<typeof itemPage> = await request(
      `/menu/items${queryString({ brandId, limit: ALL_PAGE_SIZE, cursor })}`,
      { schema: itemPage },
    );
    items.push(...page.data);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return items;
}

export const getItem = (id: string) =>
  request(`/menu/items/${id}`, { schema: menuItemDetailSchema });

export const createItem = (body: CreateItemInput) =>
  request('/menu/items', { method: 'POST', body, schema: menuItemDetailSchema });

export const updateItem = (id: string, body: UpdateItemRequest) =>
  request(`/menu/items/${id}`, { method: 'PATCH', body, schema: menuItemDetailSchema });

export async function listOverrides(itemId: string) {
  const { data } = await request(`/menu/items/${itemId}/branch-overrides`, {
    schema: listOf(branchOverrideSchema),
  });
  return data;
}

export const putOverride = (itemId: string, body: PutBranchOverrideInput) =>
  request(`/menu/items/${itemId}/branch-override`, {
    method: 'PUT',
    body,
    schema: branchOverrideSchema,
  });

// ---- modifier groups and modifiers

export const createModifierGroup = (itemId: string, body: CreateModifierGroupInput) =>
  request(`/menu/items/${itemId}/modifier-groups`, {
    method: 'POST',
    body,
    schema: modifierGroupSchema,
  });

export const updateModifierGroup = (id: string, body: UpdateModifierGroupRequest) =>
  request(`/menu/modifier-groups/${id}`, { method: 'PATCH', body, schema: modifierGroupSchema });

export const createModifier = (groupId: string, body: CreateModifierInput) =>
  request(`/menu/modifier-groups/${groupId}/modifiers`, {
    method: 'POST',
    body,
    schema: modifierSchema,
  });

export const updateModifier = (id: string, body: UpdateModifierRequest) =>
  request(`/menu/modifiers/${id}`, { method: 'PATCH', body, schema: modifierSchema });

// ---- combos

export async function listCombos(brandId: string, status?: MenuStatus) {
  const { data } = await request(`/menu/combos${queryString({ brandId, status })}`, {
    schema: listOf(comboSchema),
  });
  return data;
}

export const getCombo = (id: string) => request(`/menu/combos/${id}`, { schema: comboSchema });

export const createCombo = (body: CreateComboInput) =>
  request('/menu/combos', { method: 'POST', body, schema: comboSchema });

export const updateCombo = (id: string, body: UpdateComboRequest) =>
  request(`/menu/combos/${id}`, { method: 'PATCH', body, schema: comboSchema });

// ---- the menu of one branch, as its terminal loads it

export const getBranchMenu = (branchId: string) =>
  request(`/menu${queryString({ branchId })}`, { schema: branchMenuSchema });

// ---- recipes (docs/specs/013-recipes.md)

// The dish or the modifier a recipe belongs to.
export type RecipeOwner = { itemId: string } | { modifierId: string };

const recipePath = (owner: RecipeOwner) =>
  'itemId' in owner
    ? `/menu/items/${owner.itemId}/recipe`
    : `/menu/modifiers/${owner.modifierId}/recipe`;

export const getRecipe = (owner: RecipeOwner) =>
  request(recipePath(owner), { schema: recipeSchema });

export const putRecipe = (owner: RecipeOwner, body: PutRecipeRequest) =>
  request(recipePath(owner), { method: 'PUT', body, schema: recipeSchema });

// ---- promotions (docs/specs/021-promotions.md)

export type PromotionInput = z.input<typeof updatePromotionRequestSchema>;

export const promotionKeys = {
  list: (brandId: string) => ['menu', brandId, 'promotions'] as const,
};

export async function listPromotions(brandId: string) {
  const { data } = await request(`/menu/promotions${queryString({ brandId })}`, {
    schema: listOf(promotionSchema),
  });
  return data;
}

export const createPromotion = (body: PromotionInput & { brandId: string }) =>
  request('/menu/promotions', { method: 'POST', body, schema: promotionSchema });

export const updatePromotion = (id: string, body: PromotionInput) =>
  request(`/menu/promotions/${id}`, { method: 'PATCH', body, schema: promotionSchema });
