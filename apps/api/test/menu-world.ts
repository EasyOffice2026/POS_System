import type { PasswordHasher } from '../src/lib/password';
import type { PrismaClient } from '../src/lib/prisma';
import { createCategory, createItem } from './factories';
import { createUsersWorld } from './users-world';

// The world of the people tests (see users-world.ts) with a menu for each brand:
//
//   Pizza:  categories Pizzas, Drinks      items Margherita 20.000, Pepperoni 24.000 (Pizzas)
//                                                Cola 5.000 (Drinks)
//   Burger: category Burgers               item  Cheeseburger 18.000
export async function createMenuWorld(prisma: PrismaClient, hasher: PasswordHasher) {
  const base = await createUsersWorld(prisma, hasher);

  const pizzas = await createCategory(prisma, base.pizza.id, 'Pizzas', 0);
  const drinks = await createCategory(prisma, base.pizza.id, 'Drinks', 1);
  const burgers = await createCategory(prisma, base.burger.id, 'Burgers', 0);

  const margherita = await createItem(prisma, base.pizza.id, pizzas.id, 'Margherita', '20.000');
  const pepperoni = await createItem(prisma, base.pizza.id, pizzas.id, 'Pepperoni', '24.000');
  const cola = await createItem(prisma, base.pizza.id, drinks.id, 'Cola', '5.000');
  const cheeseburger = await createItem(
    prisma,
    base.burger.id,
    burgers.id,
    'Cheeseburger',
    '18.000',
  );

  return {
    ...base,
    categories: { pizzas, drinks, burgers },
    items: { margherita, pepperoni, cola, cheeseburger },
  };
}

export type MenuWorld = Awaited<ReturnType<typeof createMenuWorld>>;
