import {
  type AddOrderLineRequest,
  type BranchMenu,
  type BranchMenuItem,
  isOpenAtInstant,
  type LocalizedText,
  type OrderComboChoice,
  type OrderModifier,
  toMils,
} from '@pos/shared';
import { errors } from '../../lib/http-errors';

// A line as it will be stored: what was chosen, with names and prices copied from the menu of the
// branch at this moment. See docs/specs/005-orders.md, rules 4 and 5.
export interface PricedLine {
  kind: 'item' | 'combo';
  itemId: string | null;
  comboId: string | null;
  name: LocalizedText;
  unitMils: number;
  modifiers: OrderModifier[];
  choices: OrderComboChoice[];
}

interface Problem {
  path: string;
  message: string;
}

// The paths of problems start at the request: "itemId", "modifierIds", "modifiers.<group id>",
// and for a combo "choices.<slot id>" with the same paths under it.
const join = (prefix: string, rest: string) => (prefix ? `${prefix}.${rest}` : rest);

// The modifiers chosen for one dish, checked against its groups: each must be on offer, and each
// group's fewest and most choices are kept. Problems go on the list under the path given.
function chooseModifiers(
  item: BranchMenuItem,
  modifierIds: string[],
  path: string,
  problems: Problem[],
): OrderModifier[] {
  const offered = new Map(
    item.modifierGroups.flatMap((group) =>
      group.modifiers.map((modifier) => [modifier.id, { group, modifier }] as const),
    ),
  );

  const chosen: OrderModifier[] = [];
  for (const id of modifierIds) {
    const found = offered.get(id);
    if (!found) {
      problems.push({ path: join(path, 'modifierIds'), message: 'MODIFIER_NOT_AVAILABLE' });
      continue;
    }
    chosen.push({
      id,
      groupId: found.group.id,
      name: found.modifier.name,
      priceDelta: found.modifier.priceDelta,
    });
  }

  for (const group of item.modifierGroups) {
    const count = chosen.filter((modifier) => modifier.groupId === group.id).length;
    const groupPath = join(path, `modifiers.${group.id}`);
    if (count < group.minSelect) {
      problems.push({ path: groupPath, message: 'MODIFIER_CHOICE_MISSING' });
    } else if (count > group.maxSelect) {
      problems.push({ path: groupPath, message: 'TOO_MANY_MODIFIERS' });
    }
  }
  return chosen;
}

// Whether a dish can be sold at this moment, on the branch's clock.
const soldNow = (item: BranchMenuItem, menu: BranchMenu, now: Date) =>
  !item.schedule || isOpenAtInstant(item.schedule, now, menu.timezone);

const sumMils = (values: string[]) => values.reduce((total, value) => total + toMils(value), 0);

export function priceLine(menu: BranchMenu, input: AddOrderLineRequest, now: Date): PricedLine {
  const items = new Map(
    menu.categories.flatMap((category) => category.items.map((item) => [item.id, item] as const)),
  );
  const problems: Problem[] = [];

  if (input.kind === 'item') {
    const item = items.get(input.itemId);
    if (!item) throw errors.validation([{ path: 'itemId', message: 'ITEM_NOT_AVAILABLE' }]);
    if (!soldNow(item, menu, now)) {
      problems.push({ path: 'itemId', message: 'ITEM_NOT_AVAILABLE_NOW' });
    }

    const modifiers = chooseModifiers(item, input.modifierIds, '', problems);
    if (problems.length > 0) throw errors.validation(problems);

    const unit = toMils(item.price) + sumMils(modifiers.map((modifier) => modifier.priceDelta));
    return {
      kind: 'item',
      itemId: item.id,
      comboId: null,
      name: item.name,
      unitMils: Math.max(0, unit),
      modifiers,
      choices: [],
    };
  }

  const combo = menu.combos.find((candidate) => candidate.id === input.comboId);
  if (!combo) throw errors.validation([{ path: 'comboId', message: 'COMBO_NOT_AVAILABLE' }]);

  const slotIds = new Set(combo.slots.map((slot) => slot.id));
  for (const choice of input.choices) {
    if (!slotIds.has(choice.slotId)) {
      problems.push({ path: `choices.${choice.slotId}`, message: 'SLOT_NOT_FOUND' });
    }
  }

  const choices: OrderComboChoice[] = [];
  for (const slot of combo.slots) {
    const path = `choices.${slot.id}`;
    const choice = input.choices.find((candidate) => candidate.slotId === slot.id);
    if (!choice) {
      problems.push({ path, message: 'SLOT_CHOICE_MISSING' });
      continue;
    }
    const option = slot.options.find((candidate) => candidate.itemId === choice.itemId);
    const item = option ? items.get(option.itemId) : undefined;
    if (!option || !item) {
      problems.push({ path, message: 'OPTION_NOT_AVAILABLE' });
      continue;
    }
    if (!soldNow(item, menu, now)) problems.push({ path, message: 'ITEM_NOT_AVAILABLE_NOW' });

    choices.push({
      slotId: slot.id,
      slotName: slot.name,
      itemId: item.id,
      name: item.name,
      priceDelta: option.priceDelta,
      modifiers: chooseModifiers(item, choice.modifierIds, path, problems),
    });
  }
  if (problems.length > 0) throw errors.validation(problems);

  const unit =
    toMils(combo.price) +
    sumMils(
      choices.flatMap((choice) => [
        choice.priceDelta,
        ...choice.modifiers.map((modifier) => modifier.priceDelta),
      ]),
    );
  return {
    kind: 'combo',
    itemId: null,
    comboId: combo.id,
    name: combo.name,
    unitMils: Math.max(0, unit),
    modifiers: [],
    choices,
  };
}
