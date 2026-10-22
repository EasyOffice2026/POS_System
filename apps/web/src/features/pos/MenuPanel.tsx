import {
  type BranchMenu,
  type BranchMenuItem,
  isOpenAtInstant,
  normalizeSearchText,
  searchTextOf,
} from '@pos/shared';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Price } from '../../components/Price';
import { localize } from '../../i18n/localize';
import type { Choosing } from './ChoiceDialog';

const COMBOS = 'combos';

// A dish on the till: its photo square like on the brand's website, or its first letter on the
// brand's tint, so every tile has the same height; the name and a bold price below.
const tileClass =
  'group relative flex flex-col overflow-hidden rounded-card border border-line bg-white text-start transition-[border-color,box-shadow] hover:border-slate-400 focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none disabled:cursor-not-allowed';

interface MenuPanelProps {
  menu: BranchMenu;
  now: Date;
  disabled: boolean;
  onPick: (choosing: Choosing) => void;
  // How many of each dish and combo the order on the screen already has.
  inOrder?: ReadonlyMap<string, number>;
}

function Photo({ url, name }: { url: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        // A link that no longer works leaves the tile with its letter, not a broken picture.
        onError={() => setBroken(true)}
        className="aspect-square w-full bg-slate-100 object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="grid aspect-square w-full place-items-center bg-brand-soft text-4xl font-bold text-brand"
    >
      {Array.from(name.trim())[0] ?? ''}
    </span>
  );
}

// The menu of the branch: a tab per category and one for the combos, and a search over the names
// in both languages. A dish outside its times is greyed out. See docs/specs/006-pos-terminal.md,
// rule 4.
export function MenuPanel({ menu, now, disabled, onPick, inOrder }: MenuPanelProps) {
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
    `inline-flex min-h-11 shrink-0 items-center gap-2 rounded-control border px-4 text-sm font-semibold whitespace-nowrap transition-colors ${
      active
        ? 'border-ink bg-ink text-white shadow-[inset_0_-3px_0_var(--color-brand)]'
        : 'border-line bg-white text-slate-700 hover:border-slate-400'
    }`;
  const countClass = (active: boolean) =>
    `num text-xs font-medium ${active ? 'text-slate-300' : 'text-slate-400'}`;

  const badge = (id: string) => {
    const count = inOrder?.get(id) ?? 0;
    return count > 0 ? (
      <span
        className="num absolute top-2 end-2 rounded-full bg-ink px-2.5 py-0.5 text-sm font-bold text-white shadow-[0_2px_6px_rgb(0_0_0/0.25)]"
        aria-label={t('pos.menu.inOrder', { count })}
      >
        × {count}
      </span>
    ) : null;
  };
  const inOrderClass = (id: string) =>
    (inOrder?.get(id) ?? 0) > 0 ? 'border-ink shadow-[0_0_0_1px_var(--color-ink)]' : '';

  return (
    <section aria-label={t('pos.menu.label')} className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
        <label className="relative block w-full shrink-0 sm:w-56">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 size-[18px] -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            dir="auto"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('pos.menu.search')}
            aria-label={t('pos.menu.search')}
            className="min-h-11 w-full rounded-control border border-line bg-white ps-10 pe-3 text-sm hover:border-slate-400 focus:border-ink focus:ring-2 focus:ring-ink/15 focus:outline-none"
          />
        </label>

        {!query && (
          <div role="tablist" className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-0.5">
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
                <span aria-hidden="true" className={countClass(tab === category.id)}>
                  {category.items.length}
                </span>
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
                <span aria-hidden="true" className={countClass(tab === COMBOS)}>
                  {menu.combos.length}
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      {items.length === 0 && combos.length === 0 && (
        <p className="text-sm text-slate-500">
          {query ? t('pos.menu.noMatch') : t('pos.menu.empty')}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {items.map((item) => {
          const available = soldNow(item);
          const name = localize(item.name, i18n.language);
          return (
            <button
              key={item.id}
              type="button"
              disabled={disabled || !available}
              onClick={() => onPick({ kind: 'item', item })}
              className={`${tileClass} ${inOrderClass(item.id)} ${available ? '' : 'opacity-55'}`}
            >
              <Photo url={item.imageUrl} name={name} />
              {badge(item.id)}
              {!available && (
                <span className="absolute top-2 start-2 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 shadow-sm">
                  {t('menu.preview.notNow')}
                </span>
              )}
              <span className="flex flex-1 flex-col gap-1 px-3 pt-2.5 pb-3">
                <span className="text-[15px] leading-snug font-semibold text-ink">{name}</span>
                <span className="num mt-auto text-[15px] font-bold text-ink">
                  <Price value={item.price} />
                </span>
              </span>
            </button>
          );
        })}
        {combos.map((combo) => {
          const name = localize(combo.name, i18n.language);
          return (
            <button
              key={combo.id}
              type="button"
              disabled={disabled}
              onClick={() => onPick({ kind: 'combo', combo })}
              className={`${tileClass} ${inOrderClass(combo.id)}`}
            >
              <Photo url={null} name={name} />
              {badge(combo.id)}
              <span className="flex flex-1 flex-col gap-1 px-3 pt-2.5 pb-3">
                <span className="text-[15px] leading-snug font-semibold text-ink">{name}</span>
                <span className="num mt-auto text-[15px] font-bold text-ink">
                  <Price value={combo.price} />
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
