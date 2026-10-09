import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { ActiveBadge } from '../../components/ActiveBadge';
import { localize } from '../../i18n/localize';
import { listBrands } from '../admin/admin-api';
import { useAuth } from '../auth/auth-context';

// The brands of the group. A brand manager sees only their own, and only a group admin changes them.
export function BrandsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const canWrite = user?.permissions.includes('brands:write') ?? false;
  const canSeeBranches = user?.permissions.includes('branches:read') ?? false;
  // Set by the form after it creates a brand.
  const created = (useLocation().state as { notice?: string } | null)?.notice === 'created';

  const brands = useQuery({ queryKey: ['brands'], queryFn: listBrands });
  // The name in the other language is shown under the name, to check both at a glance.
  const otherLanguage = i18n.language === 'ar' ? 'en' : 'ar';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('brands.title')}</h1>
        {canWrite && (
          <Link
            to="/admin/brands/new"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:outline-none"
          >
            {t('brands.newBrand')}
          </Link>
        )}
      </div>

      {created && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {t('brands.created')}
        </p>
      )}

      {brands.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {brands.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {brands.isSuccess && brands.data.length === 0 && (
        <p className="text-sm text-slate-500">{t('brands.empty')}</p>
      )}

      {brands.data && brands.data.length > 0 && (
        <div className="relative overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-start text-sm whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('brands.columns.name')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('brands.columns.status')}
                </th>
                {canSeeBranches && (
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t('brands.columns.branches')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {brands.data.map((brand) => (
                <tr key={brand.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">
                      {canWrite ? (
                        <Link to={`/admin/brands/${brand.id}`} className="underline">
                          {localize(brand.name, i18n.language)}
                        </Link>
                      ) : (
                        localize(brand.name, i18n.language)
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      <bdi lang={otherLanguage} dir="auto">
                        {brand.name[otherLanguage]}
                      </bdi>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <ActiveBadge isActive={brand.isActive} />
                  </td>
                  {canSeeBranches && (
                    <td className="px-3 py-2">
                      <Link to={`/admin/branches?brandId=${brand.id}`} className="underline">
                        {t('brands.actions.viewBranches')}
                      </Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
