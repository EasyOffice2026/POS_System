import { type MenuStatus, menuStatuses } from '@pos/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ActiveBadge } from '../../components/ActiveBadge';
import { fieldClass } from '../../components/form';
import { Price } from '../../components/Price';
import { localize } from '../../i18n/localize';
import { listCombos, menuKeys } from './menu-api';
import { useMenuContext } from './menu-context';

// The combos of the brand: one price for a set of choices.
export function CombosPage() {
  const { t, i18n } = useTranslation();
  const { brandId, canWrite } = useMenuContext();
  const [status, setStatus] = useState<MenuStatus | ''>('');

  const combos = useQuery({
    queryKey: menuKeys.combos(brandId),
    queryFn: () => listCombos(brandId),
  });

  const rows = (combos.data ?? []).filter(
    (combo) => !status || combo.isActive === (status === 'active'),
  );
  const otherLanguage = i18n.language === 'ar' ? 'en' : 'ar';

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('menu.combos.intro')}</p>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="block max-w-xs flex-1 text-sm font-medium text-slate-700">
          {t('menu.combos.filterStatus')}
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as MenuStatus | '')}
            className={fieldClass}
          >
            <option value="">{t('common.all')}</option>
            {menuStatuses.map((name) => (
              <option key={name} value={name}>
                {name === 'active' ? t('common.statusActive') : t('common.statusInactive')}
              </option>
            ))}
          </select>
        </label>

        {canWrite && (
          <Link
            to={`/admin/menu/combos/new?brandId=${brandId}`}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:outline-none"
          >
            {t('menu.combos.newCombo')}
          </Link>
        )}
      </div>

      {combos.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {combos.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {combos.isSuccess && rows.length === 0 && (
        <p className="text-sm text-slate-500">
          {status ? t('menu.combos.noMatch') : t('menu.combos.empty')}
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-start text-sm whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('menu.combos.columns.name')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('menu.combos.columns.price')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('menu.combos.columns.choices')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('menu.combos.columns.status')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((combo) => (
                <tr key={combo.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">
                      <Link to={`/admin/menu/combos/${combo.id}`} className="underline">
                        {localize(combo.name, i18n.language)}
                      </Link>
                    </div>
                    <div className="text-xs text-slate-500">
                      <bdi lang={otherLanguage} dir="auto">
                        {combo.name[otherLanguage]}
                      </bdi>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    <Price value={combo.price} />
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {combo.slots.map((slot) => localize(slot.name, i18n.language)).join(' · ')}
                  </td>
                  <td className="px-3 py-2">
                    <ActiveBadge isActive={combo.isActive} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
