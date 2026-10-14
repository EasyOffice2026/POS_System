import { useInfiniteQuery } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useSearchParams } from 'react-router';
import { fieldClass, secondaryButtonClass } from '../../components/form';
import { Price } from '../../components/Price';
import { formatDateTime } from '../../i18n/format';
import { localize } from '../../i18n/localize';
import { useAuth } from '../auth/auth-context';
import { useMenuBrand } from '../menu/use-menu-brand';
import { customerKeys, listCustomers } from './customers-api';

// The brand's customers, the latest visits first, found by phone or name.
// See docs/specs/022-loyalty.md.
export function CustomersPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  // A group admin's brand is in the address; the links keep it.
  const { search } = useLocation();
  const [, setSearchParams] = useSearchParams();
  const menuBrand = useMenuBrand();
  const { brandId } = menuBrand;
  const chooseBrand = user?.brandId == null && menuBrand.brands.length > 1;
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim());

  const customers = useInfiniteQuery({
    queryKey: customerKeys.list(brandId ?? '', query),
    queryFn: ({ pageParam }) => listCustomers(brandId ?? '', query, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(brandId),
  });
  const rows = customers.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('customers.title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('customers.intro')}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {chooseBrand && (
          <label className="block text-sm font-medium text-slate-700">
            {t('settings.brand')}
            <select
              value={brandId ?? ''}
              onChange={(event) => setSearchParams({ brandId: event.target.value })}
              className={fieldClass}
            >
              {menuBrand.brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {localize(brand.name, i18n.language)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-sm font-medium text-slate-700">
          {t('customers.search')}
          <input
            type="search"
            dir="auto"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            className={fieldClass}
          />
        </label>
      </div>

      {(menuBrand.isLoading || (brandId && customers.isPending)) && (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      )}
      {(menuBrand.isError || customers.isError) && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {customers.isSuccess && rows.length === 0 && (
        <p className="text-sm text-slate-500">
          {query ? t('customers.noMatch') : t('customers.empty')}
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-start text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t('customers.customer')}</th>
                <th className="px-3 py-2 text-end font-medium">{t('customers.points')}</th>
                <th className="px-3 py-2 text-end font-medium">{t('customers.visits')}</th>
                <th className="px-3 py-2 text-end font-medium">{t('customers.spent')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('customers.lastVisit')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((customer) => (
                <tr key={customer.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <Link
                      to={{ pathname: customer.id, search }}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {customer.name ? (
                        <bdi>{customer.name}</bdi>
                      ) : (
                        <bdi dir="ltr">{customer.phone}</bdi>
                      )}
                    </Link>
                    {customer.name && (
                      <p className="text-xs text-slate-600">
                        <bdi dir="ltr">{customer.phone}</bdi>
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-end">{customer.points}</td>
                  <td className="px-3 py-2 text-end">{customer.visits}</td>
                  <td className="px-3 py-2 text-end">
                    <Price value={customer.totalSpent} />
                  </td>
                  <td className="px-3 py-2">
                    {customer.lastVisitAt
                      ? formatDateTime(customer.lastVisitAt, i18n.language)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {customers.hasNextPage && (
        <button
          type="button"
          disabled={customers.isFetchingNextPage}
          onClick={() => void customers.fetchNextPage()}
          className={secondaryButtonClass}
        >
          {customers.isFetchingNextPage ? t('common.loading') : t('common.loadMore')}
        </button>
      )}
    </div>
  );
}
