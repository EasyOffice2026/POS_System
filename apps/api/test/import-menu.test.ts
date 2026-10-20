import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importMenu } from '../prisma/menu-import';
import { createApp } from '../src/app';
import { createPasswordHasher, hashProfiles } from '../src/lib/password';
import { syncSystemRoles } from '../src/lib/roles';
import { createTestPrisma, resetDatabase, testConfig } from './helpers';
import { as, createUsersWorld, signIn, type UsersWorld } from './users-world';

// The menu import (prisma/menu-import.ts) with the menu of Mudawara (prisma/menus/mudawara.json).
const prisma = createTestPrisma();
const hasher = createPasswordHasher(hashProfiles.fast);
const app = createApp({ prisma, config: testConfig() });
let world: UsersWorld;

beforeAll(() => syncSystemRoles(prisma));
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase(prisma);
  world = await createUsersWorld(prisma, hasher);
});

const mudawara = async (): Promise<unknown> =>
  JSON.parse(await readFile(new URL('../prisma/menus/mudawara.json', import.meta.url), 'utf8'));

describe('the menu import', () => {
  it('writes the menu of Mudawara, and the till can load it', async () => {
    const counts = await importMenu(prisma, world.pizza.id, await mudawara());
    expect(counts).toEqual({ categories: 6, items: 37, groups: 8, modifiers: 17 });

    const api = as(app, await signIn(app, 'cashier@x.io'));
    const res = await api.get(`/api/v1/menu?branchId=${world.mall.id}`);
    expect(res.status).toBe(200);
    const menu = res.body as {
      categories: {
        name: { en: string };
        items: {
          name: { en: string };
          price: string;
          modifierGroups: { name: { en: string }; maxSelect: number; modifiers: unknown[] }[];
        }[];
      }[];
    };
    expect(menu.categories.map((category) => category.name.en)).toEqual([
      'Sandwiches',
      'Boxes',
      'Sides',
      'Drinks',
      'Khalia Mudawara',
      'Ice Cream Mudawara',
    ]);
    const box = menu.categories[1]?.items.find((item) => item.name.en.startsWith('Mudawara box'));
    expect(box?.price).toBe('7.600');
    expect(
      box?.modifierGroups.map((group) => [group.name.en, group.maxSelect, group.modifiers.length]),
    ).toEqual([
      ['Choose your pieces', 4, 4],
      ['Add-ons', 1, 1],
    ]);
  });

  it('can run again: prices change, nothing is doubled, and other dishes stay', async () => {
    await importMenu(prisma, world.pizza.id, await mudawara());
    const own = await prisma.menuCategory.findFirst({ where: { brandId: world.pizza.id } });
    await prisma.menuItem.create({
      data: {
        brandId: world.pizza.id,
        categoryId: own?.id ?? '',
        name: { en: 'House special', ar: 'طبق البيت' },
        basePrice: '9.000',
      },
    });

    const data = (await mudawara()) as {
      categories: { items: { name: { en: string }; price: string }[] }[];
    };
    const karak = data.categories[3]?.items.find((item) => item.name.en === 'Karak');
    if (karak) karak.price = '0.500';
    const counts = await importMenu(prisma, world.pizza.id, data);
    expect(counts.items).toBe(37);
    await expect(prisma.menuCategory.count({ where: { brandId: world.pizza.id } })).resolves.toBe(
      6,
    );
    await expect(prisma.menuItem.count({ where: { brandId: world.pizza.id } })).resolves.toBe(38);
    await expect(prisma.modifier.count({ where: { brandId: world.pizza.id } })).resolves.toBe(17);
    const updated = await prisma.menuItem.findFirst({
      where: { brandId: world.pizza.id, name: { path: ['en'], equals: 'Karak' } },
    });
    expect(updated?.basePrice.toFixed(3)).toBe('0.500');
  });

  it('refuses a file that names a group it does not define', async () => {
    await expect(
      importMenu(prisma, world.pizza.id, {
        categories: [
          {
            name: { en: 'A', ar: 'أ' },
            items: [{ name: { en: 'B', ar: 'ب' }, price: '1.000', modifierGroups: ['nope'] }],
          },
        ],
      }),
    ).rejects.toThrow('modifier group "nope"');
  });
});
