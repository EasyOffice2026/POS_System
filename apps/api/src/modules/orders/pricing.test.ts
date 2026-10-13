import { randomUUID } from 'node:crypto';
import { type BranchMenu, type BranchMenuItem, closedWeek } from '@pos/shared';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../lib/http-errors';
import { priceLine } from './pricing';

const text = (en: string) => ({ en, ar: `${en} (ar)` });

const modifier = (name: string, priceDelta: string) => ({
  id: randomUUID(),
  name: text(name),
  priceDelta,
});
const medium = modifier('Medium', '0.000');
const large = modifier('Large', '4.000');
const cheese = modifier('Cheese', '2.500');
const olives = modifier('Olives', '1.000');
const noSauce = modifier('No sauce', '-30.000');

const size = {
  id: randomUUID(),
  name: text('Size'),
  minSelect: 1,
  maxSelect: 1,
  modifiers: [medium, large],
};
const extras = {
  id: randomUUID(),
  name: text('Extras'),
  minSelect: 0,
  maxSelect: 2,
  modifiers: [cheese, olives, noSauce],
};

const item = (
  name: string,
  price: string,
  extra: Partial<BranchMenuItem> = {},
): BranchMenuItem => ({
  id: randomUUID(),
  name: text(name),
  description: null,
  price,
  imageUrl: null,
  schedule: null,
  modifierGroups: [],
  ...extra,
});

const pizza = item('Pizza', '22.500', { modifierGroups: [size, extras] });
const cola = item('Cola', '5.000');
// Sold on Mondays only.
const breakfast = item('Breakfast', '15.000', {
  schedule: { ...closedWeek(), monday: { kind: 'all_day' } },
});
const mainSlot = {
  id: randomUUID(),
  name: text('Main'),
  options: [{ itemId: pizza.id, priceDelta: '0.000' }],
};
const drinkSlot = {
  id: randomUUID(),
  name: text('Drink'),
  options: [{ itemId: cola.id, priceDelta: '1.500' }],
};
const meal = {
  id: randomUUID(),
  name: text('Meal'),
  price: '30.000',
  slots: [mainSlot, drinkSlot],
};

const menu: BranchMenu = {
  branchId: randomUUID(),
  brandId: randomUUID(),
  currency: 'KWD',
  timezone: 'Asia/Riyadh',
  categories: [{ id: randomUUID(), name: text('All'), items: [pizza, cola, breakfast] }],
  combos: [meal],
};

// 2026-10-12 is a Monday; 2026-10-13 a Tuesday.
const monday = new Date('2026-10-12T09:00:00Z');
const tuesday = new Date('2026-10-13T09:00:00Z');

const itemLine = (itemId: string, modifierIds: string[] = []) =>
  ({ kind: 'item', itemId, quantity: 1, modifierIds }) as const;

function problemsOf(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error.details;
    throw error;
  }
  throw new Error('Expected the line to be refused');
}

describe('priceLine', () => {
  it('copies the name and the branch price, and adds the modifiers', () => {
    const line = priceLine(menu, itemLine(pizza.id, [large.id, cheese.id]), monday);
    expect(line).toMatchObject({ kind: 'item', itemId: pizza.id, comboId: null, unitMils: 29000 });
    expect(line.name).toEqual(text('Pizza'));
    expect(line.modifiers).toEqual([
      { id: large.id, groupId: size.id, name: text('Large'), priceDelta: '4.000' },
      { id: cheese.id, groupId: extras.id, name: text('Cheese'), priceDelta: '2.500' },
    ]);
  });

  it('never goes below zero', () => {
    const line = priceLine(menu, itemLine(pizza.id, [medium.id, noSauce.id]), monday);
    expect(line.unitMils).toBe(0);
  });

  it('refuses an item that is not on the menu of the branch', () => {
    expect(problemsOf(() => priceLine(menu, itemLine(randomUUID()), monday))).toEqual([
      { path: 'itemId', message: 'ITEM_NOT_AVAILABLE' },
    ]);
  });

  it('refuses an item outside its hours', () => {
    expect(priceLine(menu, itemLine(breakfast.id), monday).unitMils).toBe(15000);
    expect(problemsOf(() => priceLine(menu, itemLine(breakfast.id), tuesday))).toEqual([
      { path: 'itemId', message: 'ITEM_NOT_AVAILABLE_NOW' },
    ]);
  });

  it('names each modifier problem with its group', () => {
    expect(problemsOf(() => priceLine(menu, itemLine(pizza.id), monday))).toEqual([
      { path: `modifiers.${size.id}`, message: 'MODIFIER_CHOICE_MISSING' },
    ]);
    expect(
      problemsOf(() =>
        priceLine(menu, itemLine(pizza.id, [medium.id, cheese.id, olives.id, noSauce.id]), monday),
      ),
    ).toEqual([{ path: `modifiers.${extras.id}`, message: 'TOO_MANY_MODIFIERS' }]);
    expect(
      problemsOf(() => priceLine(menu, itemLine(pizza.id, [medium.id, randomUUID()]), monday)),
    ).toEqual([{ path: 'modifierIds', message: 'MODIFIER_NOT_AVAILABLE' }]);
  });

  it('prices a combo from its price and the extras of each choice', () => {
    const line = priceLine(
      menu,
      {
        kind: 'combo',
        comboId: meal.id,
        quantity: 1,
        choices: [
          { slotId: mainSlot.id, itemId: pizza.id, modifierIds: [large.id] },
          { slotId: drinkSlot.id, itemId: cola.id, modifierIds: [] },
        ],
      },
      monday,
    );
    expect(line).toMatchObject({ kind: 'combo', itemId: null, comboId: meal.id, unitMils: 35500 });
    expect(line.choices.map((choice) => [choice.slotName.en, choice.name.en])).toEqual([
      ['Main', 'Pizza'],
      ['Drink', 'Cola'],
    ]);
  });

  it('names the slot of each combo problem', () => {
    const unknownSlot = randomUUID();
    const problems = problemsOf(() =>
      priceLine(
        menu,
        {
          kind: 'combo',
          comboId: meal.id,
          quantity: 1,
          choices: [
            { slotId: mainSlot.id, itemId: pizza.id, modifierIds: [] },
            { slotId: drinkSlot.id, itemId: pizza.id, modifierIds: [] },
            { slotId: unknownSlot, itemId: cola.id, modifierIds: [] },
          ],
        },
        monday,
      ),
    );
    expect(problems).toEqual([
      { path: `choices.${unknownSlot}`, message: 'SLOT_NOT_FOUND' },
      { path: `choices.${mainSlot.id}.modifiers.${size.id}`, message: 'MODIFIER_CHOICE_MISSING' },
      { path: `choices.${drinkSlot.id}`, message: 'OPTION_NOT_AVAILABLE' },
    ]);
  });

  it('refuses a combo that is not on the menu, and a slot left empty', () => {
    expect(
      problemsOf(() =>
        priceLine(menu, { kind: 'combo', comboId: randomUUID(), quantity: 1, choices: [] }, monday),
      ),
    ).toEqual([{ path: 'comboId', message: 'COMBO_NOT_AVAILABLE' }]);
    expect(
      problemsOf(() =>
        priceLine(
          menu,
          {
            kind: 'combo',
            comboId: meal.id,
            quantity: 1,
            choices: [{ slotId: drinkSlot.id, itemId: cola.id, modifierIds: [] }],
          },
          monday,
        ),
      ),
    ).toEqual([{ path: `choices.${mainSlot.id}`, message: 'SLOT_CHOICE_MISSING' }]);
  });
});
