import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { ActiveBadge } from '../../components/ActiveBadge';
import { fieldClass } from '../../components/form';
import { localize } from '../../i18n/localize';
import { useDirectory } from '../admin/use-directory';
import { useAuth } from '../auth/auth-context';

// The branches the person may see, for one brand or for all of them. A branch manager sees only
// their own branches here, and only a person with branches:write can add one.
export function BranchesPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const directory = useDirectory();

  const canWrite = user?.permissions.includes('branches:write') ?? false;
  const brandFilter = searchParams.get('brandId') ?? '';
  const severalBrands = directory.brands.length > 1;
  const brandNames = new Map(directory.brands.map((brand) => [brand.id, brand.name]));
  const otherLanguage = i18n.language === 'ar' ? 'en' : 'ar';

  const rows = directory.branches.filter(
    (branch) => !brandFilter || branch.brandId === brandFilter,
  );

  // A new branch goes to the brand that is chosen, or to the only brand there is.
  const newBrandId = brandFilter || (directory.brands.length === 1 ? directory.brands[0]?.id : '');
  const newBranchLink = newBrandId
    ? `/admin/branches/new?brandId=${newBrandId}`
    : '/admin/branches/new';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('branches.title')}</h1>
        {canWrite && (
          <Link
            to={newBranchLink}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:outline-none"
          >
            {t('branches.newBranch')}
          </Link>
        )}
      </div>

      {severalBrands && (
        <div className="max-w-xs">
          <label className="block text-sm font-medium text-slate-700">
            {t('branches.filterBrand')}
            <select
              value={brandFilter}
              onChange={(event) =>
                setSearchParams(event.target.value ? { brandId: event.target.value } : {})
              }
              className={fieldClass}
            >
              <option value="">{t('common.all')}</option>
              {directory.brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {localize(brand.name, i18n.language)}
                  {brand.isActive ? '' : ` ${t('common.inactiveSuffix')}`}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {directory.isLoading && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {directory.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {!directory.isLoading && !directory.isError && rows.length === 0 && (
        <p className="text-sm text-slate-500">{t('branches.empty')}</p>
      )}

      {rows.length > 0 && (
        <div className="relative overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-start text-sm whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('branches.columns.name')}
                </th>
                {severalBrands && (
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t('branches.columns.brand')}
                  </th>
                )}
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('branches.columns.address')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('branches.columns.timezone')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('branches.columns.status')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((branch) => {
                const brandName = brandNames.get(branch.brandId);
                return (
                  <tr key={branch.id}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-900">
                        <Link to={`/admin/branches/${branch.id}`} className="underline">
                          {localize(branch.name, i18n.language)}
                        </Link>
                      </div>
                      <div className="text-xs text-slate-500">
                        <bdi lang={otherLanguage} dir="auto">
                          {branch.name[otherLanguage]}
                        </bdi>
                      </div>
                    </td>
                    {severalBrands && (
                      <td className="px-3 py-2 text-slate-700">
                        {brandName ? localize(brandName, i18n.language) : '—'}
                      </td>
                    )}
                    <td className="px-3 py-2 text-slate-700" dir="auto">
                      {branch.address ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-700" dir="ltr">
                      {branch.timezone}
                    </td>
                    <td className="px-3 py-2">
                      <ActiveBadge isActive={branch.isActive} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
