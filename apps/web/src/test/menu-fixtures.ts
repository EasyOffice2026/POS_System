import type { MenuCategory, MenuItem, MenuItemDetail } from '@pos/shared';
import { ids } from './fixtures';

// Rows of the menu, as the API returns them, for the menu screens.

export const categoryIds = {
  pizzas: '01990000-0000-7000-8000-000000000401',
  sides: '01990000-0000-7000-8000-000000000402',
  drinks: '01990000-0000-7000-8000-000000000403',
};

export function menuCategory(overrides: Partial<MenuCategory> = {}): MenuCategory {
  return {
    id: categoryIds.pizzas,
    brandId: ids.pizza,
    name: { en: 'Pizzas', ar: 'البيتزا' },
    sortOrder: 0,
    isActive: true,
    ...overrides,
  };
}

export const pizzasCategory = menuCategory();

export const sidesCategory = menuCategory({
  id: categoryIds.sides,
  name: { en: 'Sides', ar: 'المقبلات' },
  sortOrder: 1,
});

export const drinksCategory = menuCategory({
  id: categoryIds.drinks,
  name: { en: 'Drinks', ar: 'المشروبات' },
  sortOrder: 2,
});

export const itemIds = {
  margherita: '01990000-0000-7000-8000-000000000501',
  pepperoni: '01990000-0000-7000-8000-000000000502',
  cola: '01990000-0000-7000-8000-000000000503',
};

export function menuItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: itemIds.margherita,
    brandId: ids.pizza,
    categoryId: categoryIds.pizzas,
    name: { en: 'Margherita', ar: 'مارجريتا' },
    description: null,
    basePrice: '25.000',
    imageUrl: null,
    isActive: true,
    ...overrides,
  };
}

export const margherita = menuItem();

export const pepperoni = menuItem({
  id: itemIds.pepperoni,
  name: { en: 'Pepperoni', ar: 'ببروني' },
  basePrice: '29.000',
});

export const cola = menuItem({
  id: itemIds.cola,
  categoryId: categoryIds.drinks,
  name: { en: 'Cola', ar: 'كولا' },
  basePrice: '5.000',
});

// An item as one item is read, with its modifier groups.
export function itemDetail(overrides: Partial<MenuItemDetail> = {}): MenuItemDetail {
  return { ...menuItem(), modifierGroups: [], ...overrides };
}
