import type {
  BranchMenu,
  BranchOverride,
  Combo,
  MenuCategory,
  MenuItem,
  MenuItemDetail,
  Modifier,
  ModifierGroup,
} from '@pos/shared';
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
    stationId: null,
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

export const groupIds = {
  size: '01990000-0000-7000-8000-000000000601',
  toppings: '01990000-0000-7000-8000-000000000602',
};

export const modifierIds = {
  small: '01990000-0000-7000-8000-000000000701',
  medium: '01990000-0000-7000-8000-000000000702',
  large: '01990000-0000-7000-8000-000000000703',
  cheese: '01990000-0000-7000-8000-000000000704',
  olives: '01990000-0000-7000-8000-000000000705',
};

export function modifier(overrides: Partial<Modifier> = {}): Modifier {
  return {
    id: modifierIds.small,
    groupId: groupIds.size,
    name: { en: 'Small', ar: 'صغير' },
    priceDelta: '-5.000',
    isActive: true,
    ...overrides,
  };
}

export function modifierGroup(overrides: Partial<ModifierGroup> = {}): ModifierGroup {
  return {
    id: groupIds.size,
    itemId: itemIds.margherita,
    name: { en: 'Size', ar: 'الحجم' },
    minSelect: 1,
    maxSelect: 1,
    isActive: true,
    modifiers: [
      modifier(),
      modifier({
        id: modifierIds.medium,
        name: { en: 'Medium', ar: 'وسط' },
        priceDelta: '0.000',
      }),
      modifier({
        id: modifierIds.large,
        name: { en: 'Large', ar: 'كبير' },
        priceDelta: '6.000',
      }),
    ],
    ...overrides,
  };
}

export const sizeGroup = modifierGroup();

export const toppingsGroup = modifierGroup({
  id: groupIds.toppings,
  name: { en: 'Extra toppings', ar: 'إضافات' },
  minSelect: 0,
  maxSelect: 3,
  modifiers: [
    modifier({
      id: modifierIds.cheese,
      groupId: groupIds.toppings,
      name: { en: 'Extra cheese', ar: 'جبنة إضافية' },
      priceDelta: '3.000',
    }),
    modifier({
      id: modifierIds.olives,
      groupId: groupIds.toppings,
      name: { en: 'Olives', ar: 'زيتون' },
      priceDelta: '2.000',
      isActive: false,
    }),
  ],
});

export function branchOverride(overrides: Partial<BranchOverride> = {}): BranchOverride {
  return {
    itemId: itemIds.margherita,
    branchId: ids.pizzaMall,
    price: null,
    isAvailable: true,
    schedule: null,
    ...overrides,
  };
}

export const comboIds = {
  pizzaMeal: '01990000-0000-7000-8000-000000000801',
  lunchDeal: '01990000-0000-7000-8000-000000000802',
};

export const slotIds = {
  pizza: '01990000-0000-7000-8000-000000000811',
  drink: '01990000-0000-7000-8000-000000000812',
};

export function combo(overrides: Partial<Combo> = {}): Combo {
  return {
    id: comboIds.pizzaMeal,
    brandId: ids.pizza,
    name: { en: 'Pizza meal', ar: 'وجبة بيتزا' },
    price: '39.000',
    isActive: true,
    slots: [
      {
        id: slotIds.pizza,
        name: { en: 'Pizza', ar: 'بيتزا' },
        options: [
          { itemId: itemIds.margherita, priceDelta: '0.000' },
          { itemId: itemIds.pepperoni, priceDelta: '3.000' },
        ],
      },
      {
        id: slotIds.drink,
        name: { en: 'Drink', ar: 'مشروب' },
        options: [{ itemId: itemIds.cola, priceDelta: '0.000' }],
      },
    ],
    ...overrides,
  };
}

export const pizzaMeal = combo();

export const lunchDeal = combo({
  id: comboIds.lunchDeal,
  name: { en: 'Lunch deal', ar: 'عرض الغداء' },
  price: '22.000',
  isActive: false,
  slots: [
    {
      id: slotIds.pizza,
      name: { en: 'Pizza', ar: 'بيتزا' },
      options: [{ itemId: itemIds.margherita, priceDelta: '0.000' }],
    },
  ],
});

// The menu of the mall branch as its terminal loads it.
export function branchMenu(overrides: Partial<BranchMenu> = {}): BranchMenu {
  return {
    branchId: ids.pizzaMall,
    brandId: ids.pizza,
    currency: 'KWD',
    timezone: 'Asia/Riyadh',
    kitchen: { screen: true, slip: false },
    categories: [
      {
        id: categoryIds.pizzas,
        name: { en: 'Pizzas', ar: 'البيتزا' },
        items: [
          {
            id: itemIds.margherita,
            name: { en: 'Margherita', ar: 'مارجريتا' },
            description: { en: 'Tomato and basil', ar: 'طماطم وريحان' },
            price: '27.000',
            imageUrl: null,
            schedule: null,
            modifierGroups: [
              {
                id: groupIds.size,
                name: { en: 'Size', ar: 'الحجم' },
                minSelect: 1,
                maxSelect: 1,
                modifiers: [
                  {
                    id: modifierIds.small,
                    name: { en: 'Small', ar: 'صغير' },
                    priceDelta: '-5.000',
                  },
                  { id: modifierIds.large, name: { en: 'Large', ar: 'كبير' }, priceDelta: '6.000' },
                ],
              },
            ],
          },
        ],
      },
      {
        id: categoryIds.drinks,
        name: { en: 'Drinks', ar: 'المشروبات' },
        items: [
          {
            id: itemIds.cola,
            name: { en: 'Cola', ar: 'كولا' },
            description: null,
            price: '5.000',
            imageUrl: null,
            schedule: null,
            modifierGroups: [],
          },
        ],
      },
    ],
    combos: [
      {
        id: comboIds.pizzaMeal,
        name: { en: 'Pizza meal', ar: 'وجبة بيتزا' },
        price: '39.000',
        slots: [
          {
            id: slotIds.pizza,
            name: { en: 'Pizza', ar: 'بيتزا' },
            options: [{ itemId: itemIds.margherita, priceDelta: '3.000' }],
          },
          {
            id: slotIds.drink,
            name: { en: 'Drink', ar: 'مشروب' },
            options: [{ itemId: itemIds.cola, priceDelta: '0.000' }],
          },
        ],
      },
    ],
    ...overrides,
  };
}
