import { z } from 'zod';
import { openingHoursSchema } from './branch-config';
import { localizedNameSchema, localizedTextSchema } from './localized';
import { priceChangeSchema, priceSchema } from './money';
import { cursorQuerySchema } from './pagination';
import { searchQuerySchema } from './search';
import { webLinkSchema } from './web-link';

// The menu belongs to a brand. A branch only stores differences: a price, a switch, a schedule.
// See docs/specs/004-menu.md. A problem in a request is a code, such as SELECT_RANGE_INVALID, that
// the web app turns into a sentence in the current language. Unknown fields are refused.

export const MAX_MODIFIER_CHOICES = 20;
export const MAX_MODIFIERS_PER_GROUP = 50;
export const MAX_COMBO_SLOTS = 10;
export const MAX_SLOT_OPTIONS = 30;
export const MAX_CATEGORIES = 500;

export const imageUrlSchema = webLinkSchema('IMAGE_URL_INVALID');

const descriptionInLanguage = z
  .string({ error: 'DESCRIPTION_REQUIRED' })
  .trim()
  .min(1, 'DESCRIPTION_REQUIRED')
  .max(500, 'DESCRIPTION_TOO_LONG');

// A description is optional, but when there is one it is in both languages.
export const localizedDescriptionSchema = z.strictObject({
  en: descriptionInLanguage,
  ar: descriptionInLanguage,
});

export const menuStatuses = ['active', 'inactive'] as const;
export const menuStatusSchema = z.enum(menuStatuses);
export type MenuStatus = z.infer<typeof menuStatusSchema>;

const somethingToUpdate = (request: object) => Object.keys(request).length > 0;

// ---------------------------------------------------------------------------------------------
// What the API answers

export const menuCategorySchema = z.object({
  id: z.uuid(),
  brandId: z.uuid(),
  name: localizedTextSchema,
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});
export type MenuCategory = z.infer<typeof menuCategorySchema>;

export const modifierSchema = z.object({
  id: z.uuid(),
  groupId: z.uuid(),
  name: localizedTextSchema,
  priceDelta: priceChangeSchema,
  isActive: z.boolean(),
});
export type Modifier = z.infer<typeof modifierSchema>;

export const modifierGroupSchema = z.object({
  id: z.uuid(),
  itemId: z.uuid(),
  name: localizedTextSchema,
  minSelect: z.number().int(),
  maxSelect: z.number().int(),
  isActive: z.boolean(),
  modifiers: z.array(modifierSchema),
});
export type ModifierGroup = z.infer<typeof modifierGroupSchema>;

export const menuItemSchema = z.object({
  id: z.uuid(),
  brandId: z.uuid(),
  categoryId: z.uuid(),
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  basePrice: priceSchema,
  imageUrl: z.string().nullable(),
  isActive: z.boolean(),
});
export type MenuItem = z.infer<typeof menuItemSchema>;

// One item with its modifier groups, as it is opened for editing.
export const menuItemDetailSchema = menuItemSchema.extend({
  modifierGroups: z.array(modifierGroupSchema),
});
export type MenuItemDetail = z.infer<typeof menuItemDetailSchema>;

// What one branch changes about one item. A branch with no changes has no override at all. A
// schedule has the shape of opening hours, and none means the item is available at all times.
export const branchOverrideSchema = z.object({
  itemId: z.uuid(),
  branchId: z.uuid(),
  price: priceSchema.nullable(),
  isAvailable: z.boolean(),
  schedule: openingHoursSchema.nullable(),
});
export type BranchOverride = z.infer<typeof branchOverrideSchema>;

export const comboOptionSchema = z.object({ itemId: z.uuid(), priceDelta: priceChangeSchema });

export const comboSlotSchema = z.object({
  id: z.uuid(),
  name: localizedTextSchema,
  options: z.array(comboOptionSchema),
});

export const comboSchema = z.object({
  id: z.uuid(),
  brandId: z.uuid(),
  name: localizedTextSchema,
  price: priceSchema,
  isActive: z.boolean(),
  slots: z.array(comboSlotSchema),
});
export type Combo = z.infer<typeof comboSchema>;

// ---------------------------------------------------------------------------------------------
// The menu of one branch, as a terminal loads it. Only what can be sold there: active categories
// and items, the items that are not switched off for the branch, with the branch price. Prices
// are the final price of the item. A schedule is sent as it is, and the terminal decides on its
// own clock whether the item is available now.

export const branchMenuModifierSchema = z.object({
  id: z.uuid(),
  name: localizedTextSchema,
  priceDelta: priceChangeSchema,
});

export const branchMenuGroupSchema = z.object({
  id: z.uuid(),
  name: localizedTextSchema,
  minSelect: z.number().int(),
  maxSelect: z.number().int(),
  modifiers: z.array(branchMenuModifierSchema),
});

export const branchMenuItemSchema = z.object({
  id: z.uuid(),
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  price: priceSchema,
  imageUrl: z.string().nullable(),
  schedule: openingHoursSchema.nullable(),
  modifierGroups: z.array(branchMenuGroupSchema),
});
export type BranchMenuItem = z.infer<typeof branchMenuItemSchema>;

export const branchMenuCategorySchema = z.object({
  id: z.uuid(),
  name: localizedTextSchema,
  items: z.array(branchMenuItemSchema),
});

export const branchMenuComboSchema = z.object({
  id: z.uuid(),
  name: localizedTextSchema,
  price: priceSchema,
  slots: z.array(comboSlotSchema),
});

export const branchMenuSchema = z.object({
  branchId: z.uuid(),
  brandId: z.uuid(),
  currency: z.literal('SAR'),
  // The branch's time zone, so a schedule is read on the branch's clock.
  timezone: z.string(),
  categories: z.array(branchMenuCategorySchema),
  combos: z.array(branchMenuComboSchema),
});
export type BranchMenu = z.infer<typeof branchMenuSchema>;

export const branchMenuQuerySchema = z.object({ branchId: z.uuid() });

// ---------------------------------------------------------------------------------------------
// Requests: categories

export const categoryListQuerySchema = z.object({
  // A group admin names the brand. Everybody else sees their own.
  brandId: z.uuid().optional(),
  status: menuStatusSchema.optional(),
});
export type CategoryListQuery = z.infer<typeof categoryListQuerySchema>;

export const createCategoryRequestSchema = z.strictObject({
  brandId: z.uuid().optional(),
  name: localizedNameSchema,
  isActive: z.boolean().default(true),
});
export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

export const updateCategoryRequestSchema = z
  .strictObject({
    name: localizedNameSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(somethingToUpdate, { message: 'NOTHING_TO_UPDATE' });
export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

// The new order of all the categories of a brand, first to last.
export const reorderCategoriesRequestSchema = z
  .strictObject({
    brandId: z.uuid().optional(),
    ids: z.array(z.uuid()).min(1).max(MAX_CATEGORIES),
  })
  .superRefine((request, ctx) => {
    if (new Set(request.ids).size !== request.ids.length) {
      ctx.addIssue({ code: 'custom', path: ['ids'], message: 'ORDER_DUPLICATE' });
    }
  });
export type ReorderCategoriesRequest = z.infer<typeof reorderCategoriesRequestSchema>;

// ---------------------------------------------------------------------------------------------
// Requests: items

export const itemListQuerySchema = cursorQuerySchema.extend({
  brandId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  status: menuStatusSchema.optional(),
  // Matches part of a name, in either language.
  q: searchQuerySchema.optional(),
});
export type ItemListQuery = z.infer<typeof itemListQuerySchema>;

export const createItemRequestSchema = z.strictObject({
  brandId: z.uuid().optional(),
  categoryId: z.uuid(),
  name: localizedNameSchema,
  description: localizedDescriptionSchema.nullable().optional(),
  basePrice: priceSchema,
  imageUrl: imageUrlSchema.nullable().optional(),
  isActive: z.boolean().default(true),
});
export type CreateItemRequest = z.infer<typeof createItemRequestSchema>;

export const updateItemRequestSchema = z
  .strictObject({
    categoryId: z.uuid().optional(),
    name: localizedNameSchema.optional(),
    description: localizedDescriptionSchema.nullable().optional(),
    basePrice: priceSchema.optional(),
    imageUrl: imageUrlSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(somethingToUpdate, { message: 'NOTHING_TO_UPDATE' });
export type UpdateItemRequest = z.infer<typeof updateItemRequestSchema>;

// Sets all of what one branch changes about the item. Leaving a field out puts it back to the
// brand's value, and a request that puts all of them back removes the override.
export const putBranchOverrideRequestSchema = z.strictObject({
  branchId: z.uuid(),
  price: priceSchema.nullable().default(null),
  isAvailable: z.boolean().default(true),
  schedule: openingHoursSchema.nullable().default(null),
});
export type PutBranchOverrideRequest = z.infer<typeof putBranchOverrideRequestSchema>;

// ---------------------------------------------------------------------------------------------
// Requests: modifier groups and modifiers

const minSelect = z
  .number({ error: 'MIN_SELECT_INVALID' })
  .int('MIN_SELECT_INVALID')
  .min(0, 'MIN_SELECT_INVALID')
  .max(MAX_MODIFIER_CHOICES, 'MIN_SELECT_INVALID');

const maxSelect = z
  .number({ error: 'MAX_SELECT_INVALID' })
  .int('MAX_SELECT_INVALID')
  .min(1, 'MAX_SELECT_INVALID')
  .max(MAX_MODIFIER_CHOICES, 'MAX_SELECT_INVALID');

// The smallest number of choices cannot be larger than the largest. A largest choice that is
// invalid on its own (below 1) already has its own problem, so this one is not added to it.
function checkChoiceRange(
  group: { minSelect?: number; maxSelect?: number },
  ctx: z.RefinementCtx,
): void {
  if (
    group.minSelect !== undefined &&
    group.maxSelect !== undefined &&
    group.maxSelect >= 1 &&
    group.minSelect > group.maxSelect
  ) {
    ctx.addIssue({ code: 'custom', path: ['maxSelect'], message: 'SELECT_RANGE_INVALID' });
  }
}

export const createModifierRequestSchema = z.strictObject({
  name: localizedNameSchema,
  priceDelta: priceChangeSchema.default('0.000'),
  isActive: z.boolean().default(true),
});
export type CreateModifierRequest = z.infer<typeof createModifierRequestSchema>;

export const updateModifierRequestSchema = z
  .strictObject({
    name: localizedNameSchema.optional(),
    priceDelta: priceChangeSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(somethingToUpdate, { message: 'NOTHING_TO_UPDATE' });
export type UpdateModifierRequest = z.infer<typeof updateModifierRequestSchema>;

// A group is made with its modifiers if wanted. A minimum of 1 or more makes a choice required.
export const createModifierGroupRequestSchema = z
  .strictObject({
    name: localizedNameSchema,
    minSelect: minSelect.default(0),
    maxSelect: maxSelect.default(1),
    modifiers: z.array(createModifierRequestSchema).max(MAX_MODIFIERS_PER_GROUP).default([]),
    isActive: z.boolean().default(true),
  })
  .superRefine(checkChoiceRange);
export type CreateModifierGroupRequest = z.infer<typeof createModifierGroupRequestSchema>;

export const updateModifierGroupRequestSchema = z
  .strictObject({
    name: localizedNameSchema.optional(),
    minSelect: minSelect.optional(),
    maxSelect: maxSelect.optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine(checkChoiceRange)
  .refine(somethingToUpdate, { message: 'NOTHING_TO_UPDATE' });
export type UpdateModifierGroupRequest = z.infer<typeof updateModifierGroupRequestSchema>;

// ---------------------------------------------------------------------------------------------
// Requests: combos

const comboOptionRequestSchema = z.strictObject({
  itemId: z.uuid(),
  // What a choice adds to the price of the combo, for example a bigger drink.
  priceDelta: priceChangeSchema.default('0.000'),
});

const comboSlotRequestSchema = z
  .strictObject({
    name: localizedNameSchema,
    options: z
      .array(comboOptionRequestSchema)
      .min(1, 'SLOT_NEEDS_OPTION')
      .max(MAX_SLOT_OPTIONS, 'TOO_MANY_OPTIONS'),
  })
  .superRefine((slot, ctx) => {
    const seen = new Set<string>();
    for (const [index, option] of slot.options.entries()) {
      if (seen.has(option.itemId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['options', index, 'itemId'],
          message: 'OPTION_DUPLICATE',
        });
      }
      seen.add(option.itemId);
    }
  });

const comboSlotsRequestSchema = z
  .array(comboSlotRequestSchema)
  .min(1, 'COMBO_NEEDS_SLOT')
  .max(MAX_COMBO_SLOTS, 'TOO_MANY_SLOTS');

export const comboListQuerySchema = z.object({
  brandId: z.uuid().optional(),
  status: menuStatusSchema.optional(),
});
export type ComboListQuery = z.infer<typeof comboListQuerySchema>;

// A combo is a fixed price for a set of choices. Each slot is one choice (a burger, a side, a
// drink), and its options are the items that can fill it.
export const createComboRequestSchema = z.strictObject({
  brandId: z.uuid().optional(),
  name: localizedNameSchema,
  price: priceSchema,
  slots: comboSlotsRequestSchema,
  isActive: z.boolean().default(true),
});
export type CreateComboRequest = z.infer<typeof createComboRequestSchema>;

// When slots are sent they replace all the slots of the combo.
export const updateComboRequestSchema = z
  .strictObject({
    name: localizedNameSchema.optional(),
    price: priceSchema.optional(),
    slots: comboSlotsRequestSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(somethingToUpdate, { message: 'NOTHING_TO_UPDATE' });
export type UpdateComboRequest = z.infer<typeof updateComboRequestSchema>;
