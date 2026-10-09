import { type MenuStatus, menuStatuses } from '@pos/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ActiveBadge } from '../../components/ActiveBadge';
import { fieldClass, secondaryButtonClass } from '../../components/form';
import { Price } from '../../components/Price';
import { localize } from '../../i18n/localize';
import { type ItemFilters, listCategories, listItemsPage, menuKeys } from './menu-api';
import { useMenuContext } from './menu-context';

// The items of the brand, with a search in both languages and filters by category and status.
export function ItemsPage() {
  const { t, i18n } = useTranslation();
  const { brandId, canWrite } = useMenuContext();

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<MenuStatus | ''>('');
  const query = useDeferredValue(search.trim());

  const filters: ItemFilters = {
    brandId,
    ...(categoryId ? { categoryId } : {}),
    ...(status ? { status } : {}),
    ...(query ? { q: query } : {}),
  };
  const filtered = Boolean(categoryId || status || query);

  const items = useInfiniteQuery({
    queryKey: menuKeys.items(filters),
    queryFn: ({ pageParam }) => listItemsPage(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const categories = useQuery({
    queryKey: menuKeys.categories(brandId),
    queryFn: () => listCategories(brandId),
  });

  const rows = items.data?.pages.flatMap((result) => result.data) ?? [];
  const categoryNames = new Map(
    (categories.data ?? []).map((category) => [
      category.id,
      localize(category.name, i18n.language) +
        (category.isActive ? '' : ` ${t('common.inactiveSuffix')}`),
    ]),
  );
  const otherLanguage = i18n.language === 'ar' ? 'en' : 'ar';
  const noCategories = categories.isSuccess && categories.data.length === 0;

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {noCategories ? (
            <p className="text-sm text-slate-600">
              {t('menu.items.needCategory')}{' '}
              <Link to="/admin/menu/categories" className="underline">
                {t('menu.items.goToCategories')}
              </Link>
            </p>
          ) : (
            <Link
              to={`/admin/menu/items/new?brandId=${brandId}${categoryId ? `&categoryId=${categoryId}` : ''}`}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:outline-none"
            >
              {t('menu.items.newItem')}
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-medium text-slate-700">
          {t('menu.items.search')}
          <input
            type="search"
            dir="auto"
            value={search}
            placeholder={t('menu.items.searchPlaceholder')}
            onChange={(event) => setSearch(event.target.value)}
            className={fieldClass}
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          {t('menu.items.filterCategory')}
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className={fieldClass}
          >
            <option value="">{t('common.all')}</option>
            {(categories.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {categoryNames.get(category.id)}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium text-slate-700">
          {t('menu.items.filterStatus')}
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
      </div>

      {items.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {items.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {items.isSuccess && rows.length === 0 && (
        <p className="text-sm text-slate-500">
          {filtered ? t('menu.items.noMatch') : t('menu.items.empty')}
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-start text-sm whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('menu.items.columns.name')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('menu.items.columns.category')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('menu.items.columns.price')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('menu.items.columns.status')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">
                      <Link to={`/admin/menu/items/${item.id}`} className="underline">
                        {localize(item.name, i18n.language)}
                      </Link>
                    </div>
                    <div className="text-xs text-slate-500">
                      <bdi lang={otherLanguage} dir="auto">
                        {item.name[otherLanguage]}
                      </bdi>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {categoryNames.get(item.categoryId) ?? '…'}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    <Price value={item.basePrice} />
                  </td>
                  <td className="px-3 py-2">
                    <ActiveBadge isActive={item.isActive} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.hasNextPage && (
        <button
          type="button"
          disabled={items.isFetchingNextPage}
          onClick={() => void items.fetchNextPage()}
          className={secondaryButtonClass}
        >
          {items.isFetchingNextPage ? t('common.loading') : t('common.loadMore')}
        </button>
      )}
    </div>
  );
}
