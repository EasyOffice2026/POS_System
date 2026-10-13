import type { Branch, Brand } from '@pos/shared';
import { useTranslation } from 'react-i18next';
import {
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useOutletContext,
  useSearchParams,
} from 'react-router';
import { fieldClass } from '../../components/form';
import { localize } from '../../i18n/localize';
import { useAuth } from '../auth/auth-context';
import { useMenuBrand } from '../menu/use-menu-brand';

// What the inventory area gives to the screen inside it.
export interface InventoryContext {
  brandId: string;
  brand: Brand | null;
  branches: Branch[];
  // Whether the person may change the list of ingredients (ingredients:write), and the stock
  // (inventory:write).
  canEditIngredients: boolean;
  canMoveStock: boolean;
}

export const useInventoryContext = () => useOutletContext<InventoryContext>();

const tabs = ['ingredients', 'stock', 'movements', 'transfers', 'counts'] as const;

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium ${
    isActive
      ? 'border-slate-900 text-slate-900'
      : 'border-transparent text-slate-600 hover:text-slate-900'
  }`;

export function InventoryIndexRedirect() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: 'stock', search }} replace />;
}

// The inventory area: the brand the ingredients belong to, and its sections. A group admin
// chooses the brand; everybody else works on their own. See docs/specs/012-ingredients-and-stock.md.
export function InventoryLayout() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [, setSearchParams] = useSearchParams();
  const menuBrand = useMenuBrand();
  const { brandId } = menuBrand;
  const chooseBrand = user?.brandId == null && menuBrand.brands.length > 1;
  const search = chooseBrand && brandId ? `?brandId=${brandId}` : '';

  const context: InventoryContext | null = brandId
    ? {
        brandId,
        brand: menuBrand.brand,
        branches: menuBrand.branches,
        canEditIngredients: user?.permissions.includes('ingredients:write') ?? false,
        canMoveStock: user?.permissions.includes('inventory:write') ?? false,
      }
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('inventory.title')}</h1>
        {chooseBrand && (
          <label className="block text-sm font-medium text-slate-700">
            {t('inventory.brand')}
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
      </div>

      {menuBrand.isLoading && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {menuBrand.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}

      {context && (
        <>
          <nav
            aria-label={t('inventory.tabs.label')}
            className="flex gap-1 border-b border-slate-200"
          >
            {tabs.map((tab) => (
              <NavLink key={tab} to={{ pathname: tab, search }} className={tabClass}>
                {t(`inventory.tabs.${tab}`)}
              </NavLink>
            ))}
          </nav>
          <Outlet context={context} />
        </>
      )}
    </div>
  );
}
