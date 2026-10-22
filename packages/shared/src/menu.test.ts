import { describe, expect, it } from 'vitest';
import { closedWeek } from './branch-config';
import {
  branchMenuSchema,
  branchOverrideSchema,
  categoryListQuerySchema,
  comboSchema,
  createCategoryRequestSchema,
  createComboRequestSchema,
  createItemRequestSchema,
  createModifierGroupRequestSchema,
  createModifierRequestSchema,
  itemListQuerySchema,
  menuItemDetailSchema,
  putBranchOverrideRequestSchema,
  reorderCategoriesRequestSchema,
  updateCategoryRequestSchema,
  updateComboRequestSchema,
  updateItemRequestSchema,
  updateModifierGroupRequestSchema,
  updateModifierRequestSchema,
} from './menu';

function problems(result: { success: boolean; error?: { issues: unknown[] } }): string[] {
  const issues = (result.error?.issues ?? []) as { path: PropertyKey[]; message: string }[];
  return issues.map((issue) => `${issue.path.map(String).join('.')}:${issue.message}`);
}

const id = (n: number) => `01990000-0000-7000-8000-0000000005${String(n).padStart(2, '0')}`;
const name = { en: 'Margherita', ar: 'مارجريتا' };

describe('categories', () => {
  it('needs both names, and starts active', () => {
    expect(createCategoryRequestSchema.parse({ name })).toEqual({
      name,
      isActive: true,
      stationId: null,
    });
    expect(problems(createCategoryRequestSchema.safeParse({ name: { en: 'Pizzas' } }))).toEqual([
      'name.ar:NAME_REQUIRED',
    ]);
  });

  it('takes the brand for a group admin and refuses fields it does not know', () => {
    expect(createCategoryRequestSchema.parse({ brandId: id(1), name }).brandId).toBe(id(1));
    expect(createCategoryRequestSchema.safeParse({ name, sortOrder: 3 }).success).toBe(false);
  });

  it('is changed one thing at a time, and not by an empty request', () => {
    expect(updateCategoryRequestSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(problems(updateCategoryRequestSchema.safeParse({}))).toEqual([':NOTHING_TO_UPDATE']);
  });

  it('is listed for a brand and a status', () => {
    expect(categoryListQuerySchema.parse({})).toEqual({});
    expect(categoryListQuerySchema.parse({ brandId: id(1), status: 'inactive' })).toEqual({
      brandId: id(1),
      status: 'inactive',
    });
    expect(categoryListQuerySchema.safeParse({ status: 'deleted' }).success).toBe(false);
  });

  it('is put in a new order with every id once', () => {
    expect(reorderCategoriesRequestSchema.safeParse({ ids: [id(1), id(2)] }).success).toBe(true);
    expect(problems(reorderCategoriesRequestSchema.safeParse({ ids: [id(1), id(1)] }))).toEqual([
      'ids:ORDER_DUPLICATE',
    ]);
    expect(reorderCategoriesRequestSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(reorderCategoriesRequestSchema.safeParse({ ids: ['x'] }).success).toBe(false);
  });
});

describe('creating an item', () => {
  const item = { categoryId: id(1), name, basePrice: '20.000' };

  it('needs the category, both names and a price, and starts active', () => {
    expect(createItemRequestSchema.parse(item)).toEqual({ ...item, isActive: true });
  });

  it('refuses an item with only an English name, and says which name is missing', () => {
    const result = createItemRequestSchema.safeParse({ ...item, name: { en: 'Margherita' } });

    expect(problems(result)).toEqual(['name.ar:NAME_REQUIRED']);
  });

  it('writes the price with three decimals, and refuses what is not a price', () => {
    expect(createItemRequestSchema.parse({ ...item, basePrice: '20' }).basePrice).toBe('20.000');
    expect(problems(createItemRequestSchema.safeParse({ ...item, basePrice: '-1' }))).toEqual([
      'basePrice:PRICE_INVALID',
    ]);
    expect(problems(createItemRequestSchema.safeParse({ ...item, basePrice: 20 }))).toEqual([
      'basePrice:PRICE_INVALID',
    ]);
    expect(createItemRequestSchema.safeParse({ ...item, basePrice: '1.2345' }).success).toBe(false);
  });

  it('takes a description in both languages, or none', () => {
    const description = { en: 'Tomato and mozzarella', ar: 'طماطم وموزاريلا' };

    expect(createItemRequestSchema.parse({ ...item, description }).description).toEqual(
      description,
    );
    expect(createItemRequestSchema.parse({ ...item, description: null }).description).toBeNull();
    expect(
      problems(createItemRequestSchema.safeParse({ ...item, description: { en: 'Only English' } })),
    ).toEqual(['description.ar:DESCRIPTION_REQUIRED']);
    expect(
      problems(
        createItemRequestSchema.safeParse({
          ...item,
          description: { en: 'x'.repeat(501), ar: 'ب' },
        }),
      ),
    ).toEqual(['description.en:DESCRIPTION_TOO_LONG']);
  });

  it('takes a picture as a web link, and refuses any other kind', () => {
    expect(
      createItemRequestSchema.parse({ ...item, imageUrl: 'https://cdn.example.com/a.jpg' })
        .imageUrl,
    ).toBe('https://cdn.example.com/a.jpg');
    expect(
      problems(createItemRequestSchema.safeParse({ ...item, imageUrl: 'javascript:1' })),
    ).toEqual([':IMAGE_URL_INVALID'].map((text) => `imageUrl${text}`));
  });

  it('refuses fields it does not know', () => {
    expect(createItemRequestSchema.safeParse({ ...item, sku: 'A1' }).success).toBe(false);
    expect(createItemRequestSchema.safeParse({ ...item, categoryId: 'pizzas' }).success).toBe(
      false,
    );
  });
});

describe('changing an item', () => {
  it('is changed one thing at a time, and not by an empty request', () => {
    expect(updateItemRequestSchema.safeParse({ basePrice: '22.5' }).success).toBe(true);
    expect(updateItemRequestSchema.safeParse({ description: null, imageUrl: null }).success).toBe(
      true,
    );
    expect(problems(updateItemRequestSchema.safeParse({}))).toEqual([':NOTHING_TO_UPDATE']);
  });

  it('can move the item to another category', () => {
    expect(updateItemRequestSchema.parse({ categoryId: id(2) }).categoryId).toBe(id(2));
  });
});

describe('listing items', () => {
  it('has the page defaults and no filters', () => {
    expect(itemListQuerySchema.parse({})).toEqual({ limit: 50 });
  });

  it('filters by brand, category, status and what was typed', () => {
    const query = itemListQuerySchema.parse({
      brandId: id(1),
      categoryId: id(2),
      status: 'active',
      q: '  بيتزا ',
    });

    expect(query).toMatchObject({ status: 'active', q: 'بيتزا' });
    expect(itemListQuerySchema.safeParse({ q: '   ' }).success).toBe(false);
  });
});

describe('a branch override', () => {
  const branchId = id(9);

  it('puts everything back to the brand value when only the branch is given', () => {
    expect(putBranchOverrideRequestSchema.parse({ branchId })).toEqual({
      branchId,
      price: null,
      isAvailable: true,
      schedule: null,
    });
  });

  it('takes a price, a switch and a schedule', () => {
    const request = putBranchOverrideRequestSchema.parse({
      branchId,
      price: '22.5',
      isAvailable: false,
      schedule: {
        ...closedWeek(),
        monday: { kind: 'ranges', ranges: [{ open: '11:00', close: '15:00' }] },
      },
    });

    expect(request.price).toBe('22.500');
    expect(request.isAvailable).toBe(false);
    expect(request.schedule?.monday).toEqual({
      kind: 'ranges',
      ranges: [{ open: '11:00', close: '15:00' }],
    });
  });

  it('checks the schedule with the rules of opening hours, and names the day', () => {
    const result = putBranchOverrideRequestSchema.safeParse({
      branchId,
      schedule: {
        ...closedWeek(),
        tuesday: {
          kind: 'ranges',
          ranges: [
            { open: '09:00', close: '14:00' },
            { open: '13:00', close: '18:00' },
          ],
        },
      },
    });

    expect(problems(result)).toEqual(['schedule.tuesday:HOURS_OVERLAP']);
  });

  it('refuses a price that is not a price, a missing branch, and fields it does not know', () => {
    expect(problems(putBranchOverrideRequestSchema.safeParse({ branchId, price: '-3' }))).toEqual([
      'price:PRICE_INVALID',
    ]);
    expect(putBranchOverrideRequestSchema.safeParse({}).success).toBe(false);
    expect(putBranchOverrideRequestSchema.safeParse({ branchId, itemId: id(1) }).success).toBe(
      false,
    );
  });

  it('is read as the API answers it', () => {
    const answer = {
      itemId: id(1),
      branchId,
      price: '22.500',
      isAvailable: true,
      schedule: null,
    };

    expect(branchOverrideSchema.parse(answer)).toEqual(answer);
  });
});

describe('modifier groups', () => {
  it('starts as an optional choice of one, with no modifiers', () => {
    expect(createModifierGroupRequestSchema.parse({ name })).toEqual({
      name,
      minSelect: 0,
      maxSelect: 1,
      modifiers: [],
      isActive: true,
    });
  });

  it('is required when the smallest choice is 1', () => {
    const group = createModifierGroupRequestSchema.parse({ name, minSelect: 1, maxSelect: 1 });

    expect(group.minSelect).toBe(1);
  });

  it('takes its modifiers, a price change that can be below zero, with it', () => {
    const group = createModifierGroupRequestSchema.parse({
      name,
      modifiers: [
        { name: { en: 'Large', ar: 'كبير' }, priceDelta: '4' },
        { name: { en: 'Small', ar: 'صغير' }, priceDelta: '-3' },
        { name: { en: 'Medium', ar: 'وسط' } },
      ],
    });

    expect(group.modifiers.map((modifier) => modifier.priceDelta)).toEqual([
      '4.000',
      '-3.000',
      '0.000',
    ]);
  });

  it('refuses a smallest choice that is larger than the largest, on the largest', () => {
    const result = createModifierGroupRequestSchema.safeParse({ name, minSelect: 3, maxSelect: 2 });

    expect(problems(result)).toEqual(['maxSelect:SELECT_RANGE_INVALID']);
  });

  it.each([
    [{ minSelect: -1 }, 'minSelect:MIN_SELECT_INVALID'],
    [{ minSelect: 21 }, 'minSelect:MIN_SELECT_INVALID'],
    [{ minSelect: 1.5 }, 'minSelect:MIN_SELECT_INVALID'],
    [{ maxSelect: 0 }, 'maxSelect:MAX_SELECT_INVALID'],
    [{ maxSelect: 21 }, 'maxSelect:MAX_SELECT_INVALID'],
    [{ maxSelect: '2' }, 'maxSelect:MAX_SELECT_INVALID'],
  ])('refuses %j', (limits, expected) => {
    const result = createModifierGroupRequestSchema.safeParse({ name, ...limits });

    expect(problems(result)).toContain(expected);
  });

  it('does not add a range problem to a largest choice that is invalid on its own', () => {
    const result = createModifierGroupRequestSchema.safeParse({ name, minSelect: 1, maxSelect: 0 });

    expect(problems(result)).toEqual(['maxSelect:MAX_SELECT_INVALID']);
  });

  it('needs both names', () => {
    expect(problems(createModifierGroupRequestSchema.safeParse({ name: { en: 'Size' } }))).toEqual([
      'name.ar:NAME_REQUIRED',
    ]);
  });

  it('is changed one thing at a time, and checks the two limits only when both are sent', () => {
    expect(updateModifierGroupRequestSchema.safeParse({ minSelect: 5 }).success).toBe(true);
    expect(updateModifierGroupRequestSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(
      problems(updateModifierGroupRequestSchema.safeParse({ minSelect: 3, maxSelect: 2 })),
    ).toEqual(['maxSelect:SELECT_RANGE_INVALID']);
    expect(problems(updateModifierGroupRequestSchema.safeParse({}))).toEqual([
      ':NOTHING_TO_UPDATE',
    ]);
  });
});

describe('modifiers', () => {
  it('start with no price change and active', () => {
    expect(createModifierRequestSchema.parse({ name })).toEqual({
      name,
      priceDelta: '0.000',
      isActive: true,
    });
  });

  it('are changed one thing at a time', () => {
    expect(updateModifierRequestSchema.parse({ priceDelta: '-1.5' }).priceDelta).toBe('-1.500');
    expect(problems(updateModifierRequestSchema.safeParse({}))).toEqual([':NOTHING_TO_UPDATE']);
    expect(problems(updateModifierRequestSchema.safeParse({ priceDelta: 'free' }))).toEqual([
      'priceDelta:PRICE_INVALID',
    ]);
  });
});

describe('combos', () => {
  const slot = {
    name: { en: 'Drink', ar: 'مشروب' },
    options: [{ itemId: id(1) }, { itemId: id(2) }],
  };
  const combo = { name: { en: 'Pizza meal', ar: 'وجبة بيتزا' }, price: '35', slots: [slot] };

  it('is a fixed price for slots, each with items that can fill it', () => {
    const request = createComboRequestSchema.parse(combo);

    expect(request.price).toBe('35.000');
    expect(request.isActive).toBe(true);
    expect(request.slots[0]?.options).toEqual([
      { itemId: id(1), priceDelta: '0.000' },
      { itemId: id(2), priceDelta: '0.000' },
    ]);
  });

  it('lets a choice add to the price', () => {
    const request = createComboRequestSchema.parse({
      ...combo,
      slots: [{ ...slot, options: [{ itemId: id(1), priceDelta: '2.5' }] }],
    });

    expect(request.slots[0]?.options[0]?.priceDelta).toBe('2.500');
  });

  it('needs a slot, and a slot needs an item', () => {
    expect(problems(createComboRequestSchema.safeParse({ ...combo, slots: [] }))).toEqual([
      'slots:COMBO_NEEDS_SLOT',
    ]);
    expect(
      problems(createComboRequestSchema.safeParse({ ...combo, slots: [{ ...slot, options: [] }] })),
    ).toEqual(['slots.0.options:SLOT_NEEDS_OPTION']);
  });

  it('refuses the same item twice in one slot, and names the second', () => {
    const result = createComboRequestSchema.safeParse({
      ...combo,
      slots: [{ ...slot, options: [{ itemId: id(1) }, { itemId: id(2) }, { itemId: id(1) }] }],
    });

    expect(problems(result)).toEqual(['slots.0.options.2.itemId:OPTION_DUPLICATE']);
  });

  it('allows the same item in two slots', () => {
    const result = createComboRequestSchema.safeParse({ ...combo, slots: [slot, slot] });

    expect(result.success).toBe(true);
  });

  it('has limits on the slots and the items in a slot', () => {
    const many = Array.from({ length: 11 }, () => slot);
    const options = Array.from({ length: 31 }, (_, index) => ({ itemId: id(index) }));

    expect(problems(createComboRequestSchema.safeParse({ ...combo, slots: many }))).toEqual([
      'slots:TOO_MANY_SLOTS',
    ]);
    expect(
      problems(createComboRequestSchema.safeParse({ ...combo, slots: [{ ...slot, options }] })),
    ).toEqual(['slots.0.options:TOO_MANY_OPTIONS']);
  });

  it('needs both names for the combo and for each slot, and a price', () => {
    expect(
      problems(createComboRequestSchema.safeParse({ ...combo, name: { en: 'Pizza meal' } })),
    ).toEqual(['name.ar:NAME_REQUIRED']);
    expect(
      problems(
        createComboRequestSchema.safeParse({
          ...combo,
          slots: [{ ...slot, name: { en: 'Drink' } }],
        }),
      ),
    ).toEqual(['slots.0.name.ar:NAME_REQUIRED']);
    expect(problems(createComboRequestSchema.safeParse({ ...combo, price: '-5' }))).toEqual([
      'price:PRICE_INVALID',
    ]);
  });

  it('is changed one thing at a time, and new slots replace the old ones', () => {
    expect(updateComboRequestSchema.safeParse({ price: '40' }).success).toBe(true);
    expect(updateComboRequestSchema.safeParse({ slots: [slot] }).success).toBe(true);
    expect(problems(updateComboRequestSchema.safeParse({ slots: [] }))).toEqual([
      'slots:COMBO_NEEDS_SLOT',
    ]);
    expect(problems(updateComboRequestSchema.safeParse({}))).toEqual([':NOTHING_TO_UPDATE']);
  });

  it('is read as the API answers it', () => {
    const answer = {
      id: id(7),
      brandId: id(1),
      name: combo.name,
      price: '35.000',
      isActive: true,
      slots: [
        {
          id: id(8),
          name: slot.name,
          options: [{ itemId: id(1), priceDelta: '0.000' }],
        },
      ],
    };

    expect(comboSchema.parse(answer)).toEqual(answer);
  });
});

describe('what the API answers', () => {
  it('has an item with its modifier groups', () => {
    const item = {
      id: id(1),
      brandId: id(2),
      categoryId: id(3),
      name,
      description: null,
      basePrice: '20.000',
      imageUrl: null,
      isActive: true,
      modifierGroups: [
        {
          id: id(4),
          itemId: id(1),
          name: { en: 'Size', ar: 'الحجم' },
          minSelect: 1,
          maxSelect: 1,
          isActive: true,
          modifiers: [
            {
              id: id(5),
              groupId: id(4),
              name: { en: 'Large', ar: 'كبير' },
              priceDelta: '4.000',
              isActive: true,
            },
          ],
        },
      ],
    };

    expect(menuItemDetailSchema.parse(item)).toEqual(item);
  });

  it('has the menu of a branch, in Saudi riyals, with the time zone of the branch', () => {
    const menu = {
      branchId: id(9),
      brandId: id(2),
      currency: 'KWD',
      timezone: 'Asia/Riyadh',
      kitchen: { screen: true, slip: false, lateAfterMinutes: 12 },
      orderTypes: ['dine_in', 'takeaway'],
      brand: { logoUrl: null, color: null },
      categories: [
        {
          id: id(3),
          name: { en: 'Pizzas', ar: 'البيتزا' },
          items: [
            {
              id: id(1),
              name,
              description: null,
              price: '22.500',
              imageUrl: null,
              schedule: null,
              modifierGroups: [],
            },
          ],
        },
      ],
      combos: [],
    };

    expect(branchMenuSchema.parse(menu)).toEqual(menu);
    expect(branchMenuSchema.safeParse({ ...menu, currency: 'USD' }).success).toBe(false);
  });
});
