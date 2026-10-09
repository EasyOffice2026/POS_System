import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { ActiveBadge } from '../../components/ActiveBadge';
import { localize } from '../../i18n/localize';
import { useAuth } from '../auth/auth-context';
import { ItemActions } from './ItemActions';
import { ItemDetailsForm } from './ItemDetailsForm';
import { getItem, listCategories, menuKeys } from './menu-api';
import { useMenuBrand } from './use-menu-brand';

// One item, or a new one. A new item is made in the brand that is chosen (in the address, for a
// group admin); an item that exists shows its own brand. A person without menu:write can look at
// everything but change nothing.
export function ItemPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  // Set by the form after it creates an item.
  const created = (useLocation().state as { notice?: string } | null)?.notice === 'created';
  const menuBrand = useMenuBrand();

  const item = useQuery({
    queryKey: menuKeys.item(id ?? ''),
    queryFn: () => getItem(id ?? ''),
    enabled: Boolean(id),
  });

  const brandId = id ? (item.data?.brandId ?? null) : menuBrand.brandId;
  const categories = useQuery({
    queryKey: menuKeys.categories(brandId ?? ''),
    queryFn: () => listCategories(brandId ?? ''),
    enabled: Boolean(brandId),
  });

  const canWrite = user?.permissions.includes('menu:write') ?? false;
  const brand = menuBrand.brands.find((candidate) => candidate.id === brandId);
  // A new item starts in the category the list was filtered by, when that category exists.
  const requestedCategory = searchParams.get('categoryId') ?? '';
  const initialCategoryId = (categories.data ?? []).some(
    (category) => category.id === requestedCategory,
  )
    ? requestedCategory
    : '';

  const failed = (id ? item.isError : menuBrand.isError) || categories.isError;
  const noBrand = !id && !menuBrand.isLoading && !menuBrand.isError && !brandId;
  const ready = Boolean(brandId) && categories.isSuccess && (!id || item.isSuccess);

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {item.data ? localize(item.data.name, i18n.language) : t('menu.item.newTitle')}
          </h1>
          {brandId && (
            <p className="mt-1 flex items-center gap-2 text-sm text-slate-600">
              {brand && <span>{localize(brand.name, i18n.language)}</span>}
              {item.data && <ActiveBadge isActive={item.data.isActive} />}
            </p>
          )}
        </div>
        <Link
          to={brandId ? `/admin/menu/items?brandId=${brandId}` : '/admin/menu/items'}
          className="text-sm underline"
        >
          {t('common.back')}
        </Link>
      </div>

      {failed && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {!failed && !noBrand && !ready && (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      )}
      {noBrand && <p className="text-sm text-slate-500">{t('menu.noBrand')}</p>}

      {ready && brandId && (
        <>
          {created && (
            <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
              {t('menu.item.created')}
            </p>
          )}
          {!canWrite && <p className="text-sm text-slate-600">{t('menu.item.readOnly')}</p>}

          <ItemDetailsForm
            key={item.data?.id ?? 'new'}
            existing={item.data ?? null}
            brandId={brandId}
            categories={categories.data ?? []}
            initialCategoryId={initialCategoryId}
            readOnly={!canWrite}
          />
          {item.data && canWrite && <ItemActions item={item.data} />}
        </>
      )}
    </div>
  );
}
