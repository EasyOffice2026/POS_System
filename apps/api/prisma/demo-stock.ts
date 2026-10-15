// Demo stock for Pizza Palace, so the acceptance tests of stock and purchasing can start at once
// (docs/acceptance-tests.md, part 6): ingredients with their cost and low level, opening stock at
// both branches, the recipes of the pizzas and the cola, and two suppliers with their prices.
// Rows are written once by fixed ids; stock that already exists is never changed, so seeding again
// does not undo what the testers did.
import { localizedNameSchema, normalizeSearchText, searchTextOf } from '@pos/shared';
import type { PrismaClient } from '../src/lib/prisma';

type Unit = 'g' | 'kg' | 'ml' | 'l' | 'piece';

const id = (n: number) => `01990000-0000-7000-8000-00000000f1${String(n).padStart(2, '0')}`;

const ingredients: {
  key: string;
  name: { en: string; ar: string };
  unit: Unit;
  cost: string;
  low: string;
  mall: string;
  downtown: string;
}[] = [
  {
    key: 'dough',
    name: { en: 'Pizza dough', ar: 'عجينة بيتزا' },
    unit: 'piece',
    cost: '0.150',
    low: '40',
    mall: '120',
    downtown: '80',
  },
  {
    key: 'mozzarella',
    name: { en: 'Mozzarella', ar: 'جبن موزاريلا' },
    unit: 'kg',
    cost: '2.800',
    low: '5',
    mall: '15',
    downtown: '10',
  },
  {
    key: 'sauce',
    name: { en: 'Tomato sauce', ar: 'صلصة طماطم' },
    unit: 'l',
    cost: '0.900',
    low: '3',
    mall: '8',
    downtown: '6',
  },
  {
    key: 'pepperoni',
    name: { en: 'Pepperoni', ar: 'ببروني' },
    unit: 'kg',
    cost: '4.500',
    low: '2',
    mall: '4',
    downtown: '3',
  },
  {
    key: 'chicken',
    name: { en: 'Chicken', ar: 'دجاج' },
    unit: 'kg',
    cost: '2.200',
    low: '3',
    mall: '6',
    downtown: '4',
  },
  {
    key: 'cola',
    name: { en: 'Cola can', ar: 'علبة كولا' },
    unit: 'piece',
    cost: '0.120',
    low: '48',
    mall: '144',
    downtown: '96',
  },
];

// What one of each dish uses, by the dish's English name.
const recipes: Record<string, Record<string, string>> = {
  Margherita: { dough: '1', mozzarella: '0.150', sauce: '0.100' },
  Pepperoni: { dough: '1', mozzarella: '0.120', sauce: '0.100', pepperoni: '0.080' },
  'BBQ Chicken': { dough: '1', mozzarella: '0.120', sauce: '0.080', chicken: '0.120' },
  'Veggie Supreme': { dough: '1', mozzarella: '0.120', sauce: '0.100' },
  Cola: { cola: '1' },
};

const suppliers: {
  n: number;
  name: string;
  contactName: string;
  phone: string;
  paymentDays: number;
  prices: Record<string, string>;
}[] = [
  {
    n: 50,
    name: 'Gulf Dairy',
    contactName: 'Ahmad',
    phone: '+965 2222 3333',
    paymentDays: 30,
    prices: { mozzarella: '2.750' },
  },
  {
    n: 51,
    name: 'Kuwait Food Supply',
    contactName: 'Fatima',
    phone: '+965 2444 5555',
    paymentDays: 0,
    prices: { dough: '0.140', sauce: '0.850', pepperoni: '4.400', chicken: '2.100', cola: '0.110' },
  },
];

export async function seedDemoStock(
  prisma: PrismaClient,
  brandId: string,
  branchIds: string[],
): Promise<void> {
  const ingredientId = new Map<string, string>();
  for (const [index, ingredient] of ingredients.entries()) {
    const ingredientRowId = id(index + 1);
    ingredientId.set(ingredient.key, ingredientRowId);
    const name = localizedNameSchema.parse(ingredient.name);
    const data = {
      name,
      searchText: searchTextOf(name),
      unit: ingredient.unit,
      costPerUnit: ingredient.cost,
      lowLevel: ingredient.low,
      isActive: true,
    };
    await prisma.ingredient.upsert({
      where: { id: ingredientRowId },
      update: data,
      create: { id: ingredientRowId, brandId, ...data },
    });

    // Opening stock, once: a delivery recorded like any other.
    for (const [branchIndex, branchId] of branchIds.entries()) {
      const quantity = branchIndex === 0 ? ingredient.mall : ingredient.downtown;
      const existing = await prisma.branchStock.findUnique({
        where: { branchId_ingredientId: { branchId, ingredientId: ingredientRowId } },
      });
      if (existing) continue;
      await prisma.$transaction([
        prisma.branchStock.create({
          data: { branchId, ingredientId: ingredientRowId, brandId, quantity },
        }),
        prisma.stockMovement.create({
          data: {
            brandId,
            branchId,
            ingredientId: ingredientRowId,
            kind: 'received',
            quantity,
            quantityAfter: quantity,
            note: 'Opening stock (demo)',
          },
        }),
      ]);
    }
  }

  for (const [dish, lines] of Object.entries(recipes)) {
    const item = await prisma.menuItem.findFirst({
      where: { brandId, name: { path: ['en'], equals: dish } },
      select: { id: true },
    });
    if (!item) continue;
    for (const [key, quantity] of Object.entries(lines)) {
      const ingredientRowId = ingredientId.get(key);
      if (!ingredientRowId)
        throw new Error(`Unknown ingredient "${key}" in the recipe of ${dish}.`);
      await prisma.recipeLine.upsert({
        where: { itemId_ingredientId: { itemId: item.id, ingredientId: ingredientRowId } },
        update: { quantity },
        create: { brandId, itemId: item.id, ingredientId: ingredientRowId, quantity },
      });
    }
  }

  for (const supplier of suppliers) {
    const supplierId = id(supplier.n);
    const searchText = normalizeSearchText(supplier.name);
    // A supplier the testers made with the same name is left alone.
    const clash = await prisma.supplier.findFirst({
      where: { brandId, searchText, id: { not: supplierId } },
    });
    if (clash) continue;
    const data = {
      name: supplier.name,
      searchText,
      contactName: supplier.contactName,
      phone: supplier.phone,
      paymentDays: supplier.paymentDays,
      isActive: true,
    };
    await prisma.supplier.upsert({
      where: { id: supplierId },
      update: data,
      create: { id: supplierId, brandId, ...data },
    });
    for (const [key, price] of Object.entries(supplier.prices)) {
      const ingredientRowId = ingredientId.get(key) ?? '';
      await prisma.supplierPrice.upsert({
        where: { supplierId_ingredientId: { supplierId, ingredientId: ingredientRowId } },
        update: { price, updatedAt: new Date() },
        create: {
          supplierId,
          ingredientId: ingredientRowId,
          brandId,
          price,
          updatedAt: new Date(),
        },
      });
    }
  }
}
