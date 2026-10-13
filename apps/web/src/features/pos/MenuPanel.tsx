import {
  type BranchMenu,
  type BranchMenuItem,
  isOpenAtInstant,
  normalizeSearchText,
  searchTextOf,
} from '@pos/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Price } from '../../components/Price';
import { localize } from '../../i18n/localize';
import type { Choosing } from './ChoiceDialog';

const COMBOS = 'combos';

const tileClass =
  'flex min-h-24 flex-col justify-between rounded-lg border border-slate-200 bg-white p-3 text-start shadow-sm hover:border-slate-400 hover:bg-slate-50 focus:ring-2 focus:ring-slate-400 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60';

interface MenuPanelProps {
  menu: BranchMenu;
  now: Date;
  disabled: boolean;
  onPick: (choosing: Choosing) => void;
}

// The menu of the branch: a tab per category and one for the combos, and a search over the names
// in both languages. A dish outside its times is greyed out. See docs/specs/006-pos-terminal.md,
// rule 4.
export function MenuPanel({ menu, now, disabled, onPick }: MenuPanelProps) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState(menu.categories[0]?.id ?? COMBOS);
  const [search, setSearch] = useState('');

  const query = normalizeSearchText(search);
  const matches = (name: { en: string; ar: string }) => searchTextOf(name).includes(query);
  const soldNow = (item: BranchMenuItem) =>
    !item.schedule || isOpenAtInstant(item.schedule, now, menu.timezone);

  const allItems = menu.categories.flatMap((category) => category.items);
  const items = query
    ? allItems.filter((item) => matches(item.name))
    : (menu.categories.find((category) => category.id === tab)?.items ?? []);
  const combos = query
    ? menu.combos.filter((combo) => matches(combo.name))
    : tab === COMBOS
      ? menu.combos
      : [];

  const tabClass = (active: boolean) =>
    `shrink-0 rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap ${
      active ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'
    }`;

  return (
    <section aria-label={t('pos.menu.label')} className="flex min-h-0 flex-col gap-3">
      <input
        type="search"
        dir="auto"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('pos.menu.search')}
        aria-label={t('pos.menu.search')}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 focus:ring-2 focus:ring-slate-400 focus:outline-none"
      />

      {!query && (
        <div role="tablist" className="flex gap-2 overflow-x-auto pb-1">
          {menu.categories.map((category) => (
            <button
              key={category.id}
              type="button"
              role="tab"
              aria-selected={tab === category.id}
              onClick={() => setTab(category.id)}
              className={tabClass(tab === category.id)}
            >
              {localize(category.name, i18n.language)}
            </button>
          ))}
          {menu.combos.length > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === COMBOS}
              onClick={() => setTab(COMBOS)}
              className={tabClass(tab === COMBOS)}
            >
              {t('pos.menu.combos')}
            </button>
          )}
        </div>
      )}

      {items.length === 0 && combos.length === 0 && (
        <p className="text-sm text-slate-500">
          {query ? t('pos.menu.noMatch') : t('pos.menu.empty')}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {items.map((item) => {
          const available = soldNow(item);
          return (
            <button
              key={item.id}
              type="button"
              disabled={disabled || !available}
              onClick={() => onPick({ kind: 'item', item })}
              className={tileClass}
            >
              <span className="font-medium text-slate-900">
                {localize(item.name, i18n.language)}
              </span>
              <span className="mt-2 flex flex-wrap items-center justify-between gap-1 text-sm text-slate-700">
                <Price value={item.price} />
                {!available && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                    {t('menu.preview.notNow')}
                  </span>
                )}
              </span>
            </button>
          );
        })}
        {combos.map((combo) => (
          <button
            key={combo.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick({ kind: 'combo', combo })}
            className={tileClass}
          >
            <span className="font-medium text-slate-900">
              {localize(combo.name, i18n.language)}
            </span>
            <span className="mt-2 text-sm text-slate-700">
              <Price value={combo.price} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
