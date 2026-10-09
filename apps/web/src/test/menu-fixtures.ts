import type { MenuCategory } from '@pos/shared';
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
