import { useTranslation } from 'react-i18next';
import { NavLink, Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { fieldClass } from '../../components/form';
import { localize } from '../../i18n/localize';
import { useAuth } from '../auth/auth-context';
import type { MenuContext } from './menu-context';
import { useMenuBrand } from './use-menu-brand';

const tabs = ['items', 'categories', 'combos', 'promotions', 'preview'] as const;

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium ${
    isActive
      ? 'border-slate-900 text-slate-900'
      : 'border-transparent text-slate-600 hover:text-slate-900'
  }`;

// /admin/menu opens the first section, and keeps the choice of brand.
export function MenuIndexRedirect() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: 'items', search }} replace />;
}

// The menu area: the brand the menu belongs to, and the sections of the menu. A group admin
// chooses the brand; everybody else works on their own brand's menu.
export function MenuLayout() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [, setSearchParams] = useSearchParams();
  const menuBrand = useMenuBrand();

  const canWrite = user?.permissions.includes('menu:write') ?? false;
  const { brandId } = menuBrand;
  const chooseBrand = user?.brandId == null && menuBrand.brands.length > 1;
  // The sections keep the brand that is chosen.
  const search = chooseBrand && brandId ? `?brandId=${brandId}` : '';

  const context: MenuContext | null = brandId
    ? { brandId, brand: menuBrand.brand, branches: menuBrand.branches, canWrite }
    : null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('menu.title')}</h1>

      {chooseBrand && (
        <div className="max-w-xs">
          <label className="block text-sm font-medium text-slate-700">
            {t('menu.brand')}
            <select
              value={brandId ?? ''}
              onChange={(event) => setSearchParams({ brandId: event.target.value })}
              className={fieldClass}
            >
              {menuBrand.brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {localize(brand.name, i18n.language)}
                  {brand.isActive ? '' : ` ${t('common.inactiveSuffix')}`}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {!canWrite && <p className="text-sm text-slate-600">{t('menu.readOnly')}</p>}

      <nav
        aria-label={t('menu.tabs.label')}
        className="flex flex-wrap gap-1 border-b border-slate-200"
      >
        {tabs.map((name) => (
          <NavLink key={name} to={{ pathname: `/admin/menu/${name}`, search }} className={tabClass}>
            {t(`menu.tabs.${name}`)}
          </NavLink>
        ))}
      </nav>

      {menuBrand.isLoading && !context && (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      )}
      {menuBrand.isError && !context && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {!menuBrand.isLoading && !menuBrand.isError && !context && (
        <p className="text-sm text-slate-500">{t('menu.noBrand')}</p>
      )}

      {/* Starting again when the brand changes drops the filters of the other brand. */}
      {context && <Outlet key={context.brandId} context={context} />}
    </div>
  );
}
