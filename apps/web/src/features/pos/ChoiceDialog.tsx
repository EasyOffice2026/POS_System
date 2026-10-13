import {
  type BranchMenu,
  type BranchMenuItem,
  fromMils,
  isOpenAtInstant,
  MAX_LINE_QUANTITY,
  toMils,
} from '@pos/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { primaryButtonClass, secondaryButtonClass } from '../../components/form';
import { Price } from '../../components/Price';
import { localize } from '../../i18n/localize';
import { describeChoices } from '../menu/modifier-rule';
import type { AddLineInput } from './pos-api';

type Group = BranchMenuItem['modifierGroups'][number];
type Combo = BranchMenu['combos'][number];

export type Choosing = { kind: 'item'; item: BranchMenuItem } | { kind: 'combo'; combo: Combo };

const isComplete = (group: Group, chosen: string[]) => {
  const count = group.modifiers.filter((modifier) => chosen.includes(modifier.id)).length;
  return count >= group.minSelect && count <= group.maxSelect;
};

const deltasOf = (item: BranchMenuItem, chosen: string[]) =>
  item.modifierGroups
    .flatMap((group) => group.modifiers)
    .filter((modifier) => chosen.includes(modifier.id))
    .reduce((sum, modifier) => sum + toMils(modifier.priceDelta), 0);

// The modifiers of one group: one choice as round buttons, several as boxes that stop at the most.
function GroupChoices({
  group,
  chosen,
  onChange,
  name,
}: {
  group: Group;
  chosen: string[];
  onChange: (ids: string[]) => void;
  name: string;
}) {
  const { t, i18n } = useTranslation();
  const mine = group.modifiers.filter((modifier) => chosen.includes(modifier.id));
  const others = chosen.filter((id) => !group.modifiers.some((modifier) => modifier.id === id));
  const single = group.maxSelect === 1;

  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium text-slate-900">
        {localize(group.name, i18n.language)}
        <span className="font-normal text-slate-500"> · {describeChoices(group, t)}</span>
      </legend>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {group.modifiers.map((modifier) => {
          const checked = chosen.includes(modifier.id);
          const full = !single && !checked && mine.length >= group.maxSelect;
          return (
            <label
              key={modifier.id}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                checked ? 'border-slate-900 bg-slate-50' : 'border-slate-200'
              } ${full ? 'opacity-50' : ''}`}
            >
              <input
                type={single ? 'radio' : 'checkbox'}
                name={name}
                checked={checked}
                disabled={full}
                onChange={() => {
                  if (single) onChange([...others, modifier.id]);
                  else if (checked) onChange(chosen.filter((id) => id !== modifier.id));
                  else onChange([...chosen, modifier.id]);
                }}
                // A single choice that is not required can be taken back.
                onClick={() => {
                  if (single && checked && group.minSelect === 0) onChange(others);
                }}
              />
              <span className="min-w-0 flex-1">{localize(modifier.name, i18n.language)}</span>
              {Number(modifier.priceDelta) !== 0 && (
                <span className="text-slate-600">
                  <Price value={modifier.priceDelta} signed />
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

interface ChoiceDialogProps {
  choosing: Choosing;
  menu: BranchMenu;
  now: Date;
  onAdd: (line: AddLineInput) => void;
  onCancel: () => void;
}

// The choices of a dish (its modifier groups) or of a combo (a dish for each slot, with that
// dish's own choices), with the price as it changes. "Add" works only when every choice is made.
// See docs/specs/006-pos-terminal.md, rule 5.
export function ChoiceDialog({ choosing, menu, now, onAdd, onCancel }: ChoiceDialogProps) {
  const { t, i18n } = useTranslation();
  const [quantity, setQuantity] = useState(1);
  // For a dish: its modifiers. For a combo: the dish and the modifiers of each slot.
  const [modifierIds, setModifierIds] = useState<string[]>([]);
  const [slots, setSlots] = useState<Record<string, { itemId: string; modifierIds: string[] }>>({});

  const items = new Map(
    menu.categories.flatMap((category) => category.items.map((item) => [item.id, item] as const)),
  );
  const soldNow = (item: BranchMenuItem) =>
    !item.schedule || isOpenAtInstant(item.schedule, now, menu.timezone);

  let title: string;
  let unit: number;
  let complete: boolean;
  let line: AddLineInput;

  if (choosing.kind === 'item') {
    const { item } = choosing;
    title = localize(item.name, i18n.language);
    unit = toMils(item.price) + deltasOf(item, modifierIds);
    complete = item.modifierGroups.every((group) => isComplete(group, modifierIds));
    line = { kind: 'item', itemId: item.id, quantity, modifierIds };
  } else {
    const { combo } = choosing;
    title = localize(combo.name, i18n.language);
    unit = toMils(combo.price);
    complete = true;
    for (const slot of combo.slots) {
      const picked = slots[slot.id];
      const option = slot.options.find((candidate) => candidate.itemId === picked?.itemId);
      const item = picked ? items.get(picked.itemId) : undefined;
      if (!picked || !option || !item) {
        complete = false;
        continue;
      }
      unit += toMils(option.priceDelta) + deltasOf(item, picked.modifierIds);
      if (!item.modifierGroups.every((group) => isComplete(group, picked.modifierIds))) {
        complete = false;
      }
    }
    line = {
      kind: 'combo',
      comboId: combo.id,
      quantity,
      choices: combo.slots.flatMap((slot) => {
        const picked = slots[slot.id];
        return picked ? [{ slotId: slot.id, ...picked }] : [];
      }),
    };
  }
  const total = fromMils(Math.max(0, unit) * quantity);

  const stepClass =
    'h-10 w-10 rounded-md border border-slate-300 text-lg font-semibold hover:bg-slate-100 disabled:opacity-40';

  return (
    <Dialog title={title} onClose={onCancel}>
      <div className="space-y-4">
        {choosing.kind === 'item' &&
          choosing.item.modifierGroups.map((group) => (
            <GroupChoices
              key={group.id}
              group={group}
              chosen={modifierIds}
              onChange={setModifierIds}
              name={group.id}
            />
          ))}

        {choosing.kind === 'combo' &&
          choosing.combo.slots.map((slot) => {
            const picked = slots[slot.id];
            const pickedItem = picked ? items.get(picked.itemId) : undefined;
            return (
              <div key={slot.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
                <fieldset className="space-y-1">
                  <legend className="text-sm font-medium text-slate-900">
                    {localize(slot.name, i18n.language)}
                  </legend>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {slot.options.map((option) => {
                      const item = items.get(option.itemId);
                      if (!item) return null;
                      const available = soldNow(item);
                      return (
                        <label
                          key={option.itemId}
                          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                            picked?.itemId === item.id
                              ? 'border-slate-900 bg-slate-50'
                              : 'border-slate-200'
                          } ${available ? '' : 'opacity-50'}`}
                        >
                          <input
                            type="radio"
                            name={slot.id}
                            disabled={!available}
                            checked={picked?.itemId === item.id}
                            onChange={() =>
                              setSlots((current) => ({
                                ...current,
                                [slot.id]: { itemId: item.id, modifierIds: [] },
                              }))
                            }
                          />
                          <span className="min-w-0 flex-1">
                            {localize(item.name, i18n.language)}
                          </span>
                          {Number(option.priceDelta) !== 0 && (
                            <span className="text-slate-600">
                              <Price value={option.priceDelta} signed />
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                {picked &&
                  pickedItem?.modifierGroups.map((group) => (
                    <GroupChoices
                      key={group.id}
                      group={group}
                      chosen={picked.modifierIds}
                      name={`${slot.id}-${group.id}`}
                      onChange={(ids) =>
                        setSlots((current) => ({
                          ...current,
                          [slot.id]: { itemId: picked.itemId, modifierIds: ids },
                        }))
                      }
                    />
                  ))}
              </div>
            );
          })}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={t('pos.order.less')}
              disabled={quantity <= 1}
              onClick={() => setQuantity((current) => current - 1)}
              className={stepClass}
            >
              −
            </button>
            <span className="w-8 text-center text-lg font-semibold" aria-live="polite">
              {quantity}
            </span>
            <button
              type="button"
              aria-label={t('pos.order.more')}
              disabled={quantity >= MAX_LINE_QUANTITY}
              onClick={() => setQuantity((current) => current + 1)}
              className={stepClass}
            >
              +
            </button>
          </div>
          <p className="text-lg font-semibold">
            <Price value={total} />
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!complete}
            onClick={() => onAdd(line)}
            className={primaryButtonClass}
          >
            {t('pos.choice.add')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
