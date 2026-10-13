import { type BranchMenu, type BranchMenuItem, isOpenAtInstant } from '@pos/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { fieldClass } from '../../components/form';
import { Price } from '../../components/Price';
import { localize } from '../../i18n/localize';
import { getBranchMenu, menuKeys } from './menu-api';
import { useMenuContext } from './menu-context';
import { describeChoices } from './modifier-rule';
import { describeSchedule } from './schedule-summary';
import { useNow } from './use-now';

function PreviewItem({ item, menu, now }: { item: BranchMenuItem; menu: BranchMenu; now: Date }) {
  const { t, i18n } = useTranslation();
  const otherLanguage = i18n.language === 'ar' ? 'en' : 'ar';
  // The terminal decides on its own clock whether an item with times can be sold right now.
  const soldNow = item.schedule ? isOpenAtInstant(item.schedule, now, menu.timezone) : true;

  return (
    <li className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-900">{localize(item.name, i18n.language)}</p>
          <p className="text-xs text-slate-500">
            <bdi lang={otherLanguage} dir="auto">
              {item.name[otherLanguage]}
            </bdi>
          </p>
          {item.description && (
            <p className="mt-1 text-sm text-slate-600" dir="auto">
              {localize(item.description, i18n.language)}
            </p>
          )}
        </div>
        <p className="font-medium text-slate-900">
          <Price value={item.price} />
        </p>
      </div>

      {item.schedule && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span>{describeSchedule(item.schedule, t)}</span>
          {!soldNow && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900">
              {t('menu.preview.notNow')}
            </span>
          )}
        </p>
      )}

      {item.modifierGroups.map((group) => (
        <div key={group.id} className="text-sm text-slate-700">
          <p>
            <span className="font-medium">{localize(group.name, i18n.language)}</span>
            <span className="text-slate-500"> · {describeChoices(group, t)}</span>
          </p>
          <ul className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-slate-600">
            {group.modifiers.map((modifier) => (
              <li key={modifier.id}>
                {localize(modifier.name, i18n.language)}{' '}
                <Price value={modifier.priceDelta} signed />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </li>
  );
}

function PreviewMenu({ menu }: { menu: BranchMenu }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const itemNames = new Map(
    menu.categories.flatMap((category) =>
      category.items.map((item) => [item.id, localize(item.name, i18n.language)] as const),
    ),
  );

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        <span dir="ltr">{menu.timezone}</span> · {menu.currency}
      </p>

      {menu.categories.length === 0 && menu.combos.length === 0 && (
        <p className="text-sm text-slate-500">{t('menu.preview.empty')}</p>
      )}

      {menu.categories.map((category) => (
        <section key={category.id} className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">
            {localize(category.name, i18n.language)}
          </h2>
          <ul className="space-y-2">
            {category.items.map((item) => (
              <PreviewItem key={item.id} item={item} menu={menu} now={now} />
            ))}
          </ul>
        </section>
      ))}

      {menu.combos.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">{t('menu.preview.combos')}</h2>
          <ul className="space-y-2">
            {menu.combos.map((combo) => (
              <li
                key={combo.id}
                className="space-y-2 rounded-lg border border-slate-200 bg-white p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium text-slate-900">
                    {localize(combo.name, i18n.language)}
                  </p>
                  <p className="font-medium text-slate-900">
                    <Price value={combo.price} />
                  </p>
                </div>
                {combo.slots.map((slot) => (
                  <div key={slot.id} className="text-sm text-slate-700">
                    <p className="font-medium">{localize(slot.name, i18n.language)}</p>
                    <ul className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-slate-600">
                      {slot.options.map((option) => (
                        <li key={option.itemId}>
                          {itemNames.get(option.itemId) ?? '…'}
                          {Number(option.priceDelta) !== 0 && (
                            <>
                              {' '}
                              <Price value={option.priceDelta} signed />
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// The menu of one branch exactly as its terminal loads it: only what can be sold there, at the
// prices of the branch, with the times of the items that have them.
export function BranchMenuPreviewPage() {
  const { t, i18n } = useTranslation();
  const { branches } = useMenuContext();
  const [searchParams, setSearchParams] = useSearchParams();

  const requested = searchParams.get('branchId');
  const branchId =
    branches.find((branch) => branch.id === requested)?.id ?? branches[0]?.id ?? null;

  const menu = useQuery({
    queryKey: menuKeys.branchMenu(branchId ?? ''),
    queryFn: () => getBranchMenu(branchId ?? ''),
    enabled: Boolean(branchId),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('menu.preview.intro')}</p>

      {branches.length === 0 && (
        <p className="text-sm text-slate-500">{t('menu.preview.noBranches')}</p>
      )}

      {branches.length > 0 && (
        <div className="max-w-sm">
          <label className="block text-sm font-medium text-slate-700">
            {t('menu.preview.branch')}
            <select
              value={branchId ?? ''}
              onChange={(event) =>
                setSearchParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set('branchId', event.target.value);
                  return next;
                })
              }
              className={fieldClass}
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {localize(branch.name, i18n.language)}
                  {branch.isActive ? '' : ` ${t('common.inactiveSuffix')}`}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {menu.isPending && branchId && (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      )}
      {menu.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {menu.data && <PreviewMenu key={menu.data.branchId} menu={menu.data} />}
    </div>
  );
}
