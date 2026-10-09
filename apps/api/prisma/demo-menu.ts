// Demo menus for local development: a bilingual menu for each demo brand, with sizes and extras,
// combos, and what some branches change (a price, a switch off, a schedule). Everything is checked
// against the same rules the screens and the API use, so a mistake here stops the seed.
import {
  closedWeek,
  localizedNameSchema,
  type OpeningHours,
  openingHoursSchema,
  priceChangeSchema,
  priceSchema,
  searchTextOf,
} from '@pos/shared';
import { Prisma } from '../src/generated/prisma/client';
import type { PrismaClient } from '../src/lib/prisma';

interface Text {
  en: string;
  ar: string;
}

interface DemoGroup {
  name: Text;
  min: number;
  max: number;
  modifiers: { name: Text; delta: string }[];
}

interface DemoItem {
  category: string;
  name: Text;
  price: string;
  description?: Text;
  // Keys of the groups below. Each item gets its own copy of them.
  groups?: string[];
}

interface DemoCombo {
  name: Text;
  price: string;
  slots: { name: Text; options: { item: string; delta?: string }[] }[];
}

interface DemoOverride {
  branchId: string;
  item: string;
  price?: string;
  unavailable?: boolean;
  schedule?: OpeningHours;
}

interface DemoMenu {
  brandId: string;
  categories: Record<string, Text>;
  groups: Record<string, DemoGroup>;
  items: Record<string, DemoItem>;
  combos: DemoCombo[];
  overrides: DemoOverride[];
}

const ranges = (...pairs: [string, string][]): OpeningHours['sunday'] => ({
  kind: 'ranges',
  ranges: pairs.map(([open, close]) => ({ open, close })),
});

// Hours with the same ranges on the given days, and closed on the others.
const onDays = (days: (keyof OpeningHours)[], day: OpeningHours['sunday']): OpeningHours => {
  const hours = closedWeek();
  for (const name of days) hours[name] = day;
  return hours;
};

const everyDay: (keyof OpeningHours)[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

function demoMenus(
  brandIds: { pizza: string; burger: string },
  branchIds: {
    pizzaMall: string;
    pizzaDowntown: string;
    burgerAirport: string;
    burgerCorniche: string;
  },
): DemoMenu[] {
  const cola = { en: 'Cola', ar: 'كولا' };
  const water = { en: 'Water', ar: 'ماء' };

  const pizza: DemoMenu = {
    brandId: brandIds.pizza,
    categories: {
      pizzas: { en: 'Pizzas', ar: 'البيتزا' },
      sides: { en: 'Sides', ar: 'المقبلات' },
      drinks: { en: 'Drinks', ar: 'المشروبات' },
      desserts: { en: 'Desserts', ar: 'الحلويات' },
    },
    groups: {
      pizzaSize: {
        name: { en: 'Size', ar: 'الحجم' },
        min: 1,
        max: 1,
        modifiers: [
          { name: { en: 'Small', ar: 'صغير' }, delta: '-5.000' },
          { name: { en: 'Medium', ar: 'وسط' }, delta: '0.000' },
          { name: { en: 'Large', ar: 'كبير' }, delta: '6.000' },
        ],
      },
      toppings: {
        name: { en: 'Extra toppings', ar: 'إضافات' },
        min: 0,
        max: 3,
        modifiers: [
          { name: { en: 'Extra cheese', ar: 'جبنة إضافية' }, delta: '3.000' },
          { name: { en: 'Olives', ar: 'زيتون' }, delta: '2.000' },
          { name: { en: 'Mushrooms', ar: 'فطر' }, delta: '2.500' },
          { name: { en: 'Jalapeños', ar: 'هالبينو' }, delta: '2.000' },
        ],
      },
      drinkSize: {
        name: { en: 'Size', ar: 'الحجم' },
        min: 1,
        max: 1,
        modifiers: [
          { name: { en: 'Regular', ar: 'عادي' }, delta: '0.000' },
          { name: { en: 'Large', ar: 'كبير' }, delta: '2.000' },
        ],
      },
    },
    items: {
      margherita: {
        category: 'pizzas',
        name: { en: 'Margherita', ar: 'مارجريتا' },
        price: '25.000',
        description: {
          en: 'Tomato sauce, mozzarella and fresh basil',
          ar: 'صلصة الطماطم والموزاريلا والريحان الطازج',
        },
        groups: ['pizzaSize', 'toppings'],
      },
      pepperoni: {
        category: 'pizzas',
        name: { en: 'Pepperoni', ar: 'ببروني' },
        price: '29.000',
        description: { en: 'Spicy pepperoni and mozzarella', ar: 'ببروني حار وموزاريلا' },
        groups: ['pizzaSize', 'toppings'],
      },
      bbqChicken: {
        category: 'pizzas',
        name: { en: 'BBQ Chicken', ar: 'دجاج باربكيو' },
        price: '32.000',
        groups: ['pizzaSize', 'toppings'],
      },
      veggie: {
        category: 'pizzas',
        name: { en: 'Veggie Supreme', ar: 'خضار سوبريم' },
        price: '28.000',
        groups: ['pizzaSize', 'toppings'],
      },
      garlicBread: {
        category: 'sides',
        name: { en: 'Garlic Bread', ar: 'خبز بالثوم' },
        price: '9.000',
      },
      caesar: {
        category: 'sides',
        name: { en: 'Caesar Salad', ar: 'سلطة سيزر' },
        price: '14.000',
      },
      cola: { category: 'drinks', name: cola, price: '5.000', groups: ['drinkSize'] },
      orangeJuice: {
        category: 'drinks',
        name: { en: 'Orange Juice', ar: 'عصير برتقال' },
        price: '8.000',
        groups: ['drinkSize'],
      },
      water: { category: 'drinks', name: water, price: '2.000' },
      tiramisu: {
        category: 'desserts',
        name: { en: 'Tiramisu', ar: 'تيراميسو' },
        price: '16.000',
        description: { en: 'Coffee, mascarpone and cocoa', ar: 'قهوة ومسكربون وكاكاو' },
      },
    },
    combos: [
      {
        name: { en: 'Pizza meal', ar: 'وجبة بيتزا' },
        price: '39.000',
        slots: [
          {
            name: { en: 'Pizza', ar: 'بيتزا' },
            options: [
              { item: 'margherita' },
              { item: 'pepperoni', delta: '3.000' },
              { item: 'bbqChicken', delta: '4.000' },
            ],
          },
          {
            name: { en: 'Side', ar: 'مقبلات' },
            options: [{ item: 'garlicBread' }, { item: 'caesar' }],
          },
          {
            name: { en: 'Drink', ar: 'مشروب' },
            options: [{ item: 'cola' }, { item: 'orangeJuice', delta: '1.000' }, { item: 'water' }],
          },
        ],
      },
      {
        name: { en: 'Lunch deal', ar: 'عرض الغداء' },
        price: '22.000',
        slots: [
          { name: { en: 'Pizza', ar: 'بيتزا' }, options: [{ item: 'margherita' }] },
          {
            name: { en: 'Drink', ar: 'مشروب' },
            options: [{ item: 'cola' }, { item: 'water' }],
          },
        ],
      },
    ],
    overrides: [
      // The mall costs more to run.
      { branchId: branchIds.pizzaMall, item: 'margherita', price: '27.000' },
      { branchId: branchIds.pizzaDowntown, item: 'pepperoni', price: '30.000' },
      // Not sold downtown.
      { branchId: branchIds.pizzaDowntown, item: 'tiramisu', unavailable: true },
      // The salad at the mall is for lunch, Sunday to Thursday.
      {
        branchId: branchIds.pizzaMall,
        item: 'caesar',
        schedule: onDays(
          ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'],
          ranges(['11:00', '16:00']),
        ),
      },
    ],
  };

  const burger: DemoMenu = {
    brandId: brandIds.burger,
    categories: {
      burgers: { en: 'Burgers', ar: 'البرجر' },
      sides: { en: 'Sides', ar: 'الأطباق الجانبية' },
      drinks: { en: 'Drinks', ar: 'المشروبات' },
    },
    groups: {
      extras: {
        name: { en: 'Extras', ar: 'إضافات' },
        min: 0,
        max: 3,
        modifiers: [
          { name: { en: 'Bacon', ar: 'لحم مقدد' }, delta: '4.000' },
          { name: { en: 'Extra cheese', ar: 'جبنة إضافية' }, delta: '2.000' },
          { name: { en: 'Avocado', ar: 'أفوكادو' }, delta: '3.500' },
        ],
      },
      friesSize: {
        name: { en: 'Size', ar: 'الحجم' },
        min: 1,
        max: 1,
        modifiers: [
          { name: { en: 'Small', ar: 'صغير' }, delta: '-2.000' },
          { name: { en: 'Regular', ar: 'عادي' }, delta: '0.000' },
          { name: { en: 'Large', ar: 'كبير' }, delta: '3.000' },
        ],
      },
      flavor: {
        name: { en: 'Flavor', ar: 'النكهة' },
        min: 1,
        max: 1,
        modifiers: [
          { name: { en: 'Chocolate', ar: 'شوكولاتة' }, delta: '0.000' },
          { name: { en: 'Vanilla', ar: 'فانيلا' }, delta: '0.000' },
          { name: { en: 'Strawberry', ar: 'فراولة' }, delta: '0.000' },
        ],
      },
    },
    items: {
      cheeseburger: {
        category: 'burgers',
        name: { en: 'Cheeseburger', ar: 'تشيز برجر' },
        price: '18.000',
        description: { en: 'Beef patty, cheddar and pickles', ar: 'لحم بقري وجبنة شيدر ومخلل' },
        groups: ['extras'],
      },
      doubleCheeseburger: {
        category: 'burgers',
        name: { en: 'Double Cheeseburger', ar: 'دبل تشيز برجر' },
        price: '24.000',
        groups: ['extras'],
      },
      chickenBurger: {
        category: 'burgers',
        name: { en: 'Chicken Burger', ar: 'برجر دجاج' },
        price: '20.000',
        groups: ['extras'],
      },
      veggieBurger: {
        category: 'burgers',
        name: { en: 'Veggie Burger', ar: 'برجر نباتي' },
        price: '19.000',
        groups: ['extras'],
      },
      fries: {
        category: 'sides',
        name: { en: 'Fries', ar: 'بطاطس مقلية' },
        price: '8.000',
        groups: ['friesSize'],
      },
      onionRings: {
        category: 'sides',
        name: { en: 'Onion Rings', ar: 'حلقات البصل' },
        price: '10.000',
      },
      milkshake: {
        category: 'drinks',
        name: { en: 'Milkshake', ar: 'ميلك شيك' },
        price: '14.000',
        groups: ['flavor'],
      },
      cola: { category: 'drinks', name: cola, price: '5.000' },
      water: { category: 'drinks', name: water, price: '2.000' },
    },
    combos: [
      {
        name: { en: 'Burger meal', ar: 'وجبة برجر' },
        price: '29.000',
        slots: [
          {
            name: { en: 'Burger', ar: 'برجر' },
            options: [
              { item: 'cheeseburger' },
              { item: 'chickenBurger' },
              { item: 'veggieBurger' },
            ],
          },
          {
            name: { en: 'Side', ar: 'طبق جانبي' },
            options: [{ item: 'fries' }, { item: 'onionRings', delta: '2.000' }],
          },
          {
            name: { en: 'Drink', ar: 'مشروب' },
            options: [{ item: 'cola' }, { item: 'water' }, { item: 'milkshake', delta: '6.000' }],
          },
        ],
      },
    ],
    overrides: [
      // Airport prices are higher.
      { branchId: branchIds.burgerAirport, item: 'cheeseburger', price: '21.000' },
      { branchId: branchIds.burgerAirport, item: 'doubleCheeseburger', price: '27.000' },
      { branchId: branchIds.burgerAirport, item: 'fries', price: '10.000' },
      // Milkshakes at the corniche are sold from the afternoon until two in the morning.
      {
        branchId: branchIds.burgerCorniche,
        item: 'milkshake',
        schedule: onDays(everyDay, ranges(['14:00', '02:00'])),
      },
    ],
  };

  return [pizza, burger];
}

// Ids that are the same every time, so the seed can run again and update the same rows.
const id = (group: number, n: number) =>
  `01990000-0000-7000-8000-${String(group * 1000 + n).padStart(12, '0')}`;

const names = (text: Text) => localizedNameSchema.parse(text);

// Writes the demo menus, replacing what the demo branches changed about them.
export async function seedDemoMenus(
  prisma: PrismaClient,
  brandIds: { pizza: string; burger: string },
  branchIds: {
    pizzaMall: string;
    pizzaDowntown: string;
    burgerAirport: string;
    burgerCorniche: string;
  },
): Promise<void> {
  const counters = { category: 0, item: 0, group: 0, modifier: 0, combo: 0, slot: 0 };
  const next = (kind: keyof typeof counters) => (counters[kind] += 1);

  for (const menu of demoMenus(brandIds, branchIds)) {
    const { brandId } = menu;
    const categoryIds = new Map<string, string>();
    const itemIds = new Map<string, string>();

    for (const [index, [key, text]] of Object.entries(menu.categories).entries()) {
      const categoryId = id(4, next('category'));
      categoryIds.set(key, categoryId);
      const data = { name: names(text), sortOrder: index, isActive: true };
      await prisma.menuCategory.upsert({
        where: { id: categoryId },
        update: data,
        create: { id: categoryId, brandId, ...data },
      });
    }

    for (const [key, item] of Object.entries(menu.items)) {
      const itemId = id(5, next('item'));
      itemIds.set(key, itemId);
      const categoryId = categoryIds.get(item.category);
      if (!categoryId) throw new Error(`Unknown category "${item.category}" for ${key}.`);

      const name = names(item.name);
      const data = {
        categoryId,
        name,
        description: item.description ? names(item.description) : Prisma.DbNull,
        searchText: searchTextOf(name),
        basePrice: priceSchema.parse(item.price),
        isActive: true,
      };
      await prisma.menuItem.upsert({
        where: { id: itemId },
        update: data,
        create: { id: itemId, brandId, ...data },
      });

      for (const [position, groupKey] of (item.groups ?? []).entries()) {
        const group = menu.groups[groupKey];
        if (!group) throw new Error(`Unknown group "${groupKey}" for ${key}.`);

        const groupId = id(6, next('group'));
        const groupData = {
          itemId,
          name: names(group.name),
          minSelect: group.min,
          maxSelect: group.max,
          sortOrder: position,
          isActive: true,
        };
        await prisma.modifierGroup.upsert({
          where: { id: groupId },
          update: groupData,
          create: { id: groupId, brandId, ...groupData },
        });

        for (const [order, modifier] of group.modifiers.entries()) {
          const modifierId = id(7, next('modifier'));
          const modifierData = {
            groupId,
            name: names(modifier.name),
            priceDelta: priceChangeSchema.parse(modifier.delta),
            sortOrder: order,
            isActive: true,
          };
          await prisma.modifier.upsert({
            where: { id: modifierId },
            update: modifierData,
            create: { id: modifierId, brandId, ...modifierData },
          });
        }
      }
    }

    for (const combo of menu.combos) {
      const comboId = id(8, next('combo'));
      const data = {
        name: names(combo.name),
        price: priceSchema.parse(combo.price),
        isActive: true,
      };
      await prisma.combo.upsert({
        where: { id: comboId },
        update: data,
        create: { id: comboId, brandId, ...data },
      });

      // The slots are written again each time, and their options with them.
      await prisma.comboSlot.deleteMany({ where: { comboId } });
      for (const [order, slot] of combo.slots.entries()) {
        const slotId = id(9, next('slot'));
        await prisma.comboSlot.create({
          data: { id: slotId, brandId, comboId, name: names(slot.name), sortOrder: order },
        });
        await prisma.comboSlotOption.createMany({
          data: slot.options.map((option, position) => {
            const itemId = itemIds.get(option.item);
            if (!itemId) throw new Error(`Unknown item "${option.item}" in a combo.`);
            return {
              slotId,
              itemId,
              brandId,
              priceDelta: priceChangeSchema.parse(option.delta ?? '0.000'),
              sortOrder: position,
            };
          }),
        });
      }
    }

    await prisma.branchMenuItem.deleteMany({ where: { brandId } });
    for (const override of menu.overrides) {
      const itemId = itemIds.get(override.item);
      if (!itemId) throw new Error(`Unknown item "${override.item}" in an override.`);

      await prisma.branchMenuItem.create({
        data: {
          branchId: override.branchId,
          itemId,
          brandId,
          priceOverride: override.price ? priceSchema.parse(override.price) : null,
          isAvailable: !override.unavailable,
          ...(override.schedule ? { schedule: openingHoursSchema.parse(override.schedule) } : {}),
        },
      });
    }
  }
}
