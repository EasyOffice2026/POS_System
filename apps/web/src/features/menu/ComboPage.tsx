import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router';
import { ActiveBadge } from '../../components/ActiveBadge';
import { localize } from '../../i18n/localize';
import { useDirectory } from '../admin/use-directory';
import { useAuth } from '../auth/auth-context';
import { ComboForm } from './ComboForm';
import { getCombo, listAllItems, listCategories, menuKeys } from './menu-api';
import { useMenuBrand } from './use-menu-brand';

// One combo, or a new one. A new combo is made in the brand that is chosen (in the address, for a
// group admin); a combo that exists shows its own brand. A person without menu:write can look at
// everything but change nothing.
export function ComboPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const { user } = useAuth();
  // Set by the form after it creates a combo.
  const created = (useLocation().state as { notice?: string } | null)?.notice === 'created';
  const menuBrand = useMenuBrand();
  const directory = useDirectory();

  const combo = useQuery({
    queryKey: menuKeys.combo(id ?? ''),
    queryFn: () => getCombo(id ?? ''),
    enabled: Boolean(id),
  });

  const brandId = id ? (combo.data?.brandId ?? null) : menuBrand.brandId;
  const items = useQuery({
    queryKey: menuKeys.allItems(brandId ?? ''),
    queryFn: () => listAllItems(brandId ?? ''),
    enabled: Boolean(brandId),
  });
  const categories = useQuery({
    queryKey: menuKeys.categories(brandId ?? ''),
    queryFn: () => listCategories(brandId ?? ''),
    enabled: Boolean(brandId),
  });

  const canWrite = user?.permissions.includes('menu:write') ?? false;
  const brand = directory.brands.find((candidate) => candidate.id === brandId);

  const failed = (id ? combo.isError : menuBrand.isError) || items.isError || categories.isError;
  const noBrand = !id && !menuBrand.isLoading && !menuBrand.isError && !brandId;
  const ready =
    Boolean(brandId) && items.isSuccess && categories.isSuccess && (!id || combo.isSuccess);
  // A combo is made of items, so a brand with none cannot start one.
  const needItems = ready && !id && (items.data ?? []).length === 0;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {combo.data ? localize(combo.data.name, i18n.language) : t('menu.combo.newTitle')}
          </h1>
          {brandId && (
            <p className="mt-1 flex items-center gap-2 text-sm text-slate-600">
              {brand && <span>{localize(brand.name, i18n.language)}</span>}
              {combo.data && <ActiveBadge isActive={combo.data.isActive} />}
            </p>
          )}
        </div>
        <Link
          to={brandId ? `/admin/menu/combos?brandId=${brandId}` : '/admin/menu/combos'}
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
              {t('menu.combo.created')}
            </p>
          )}
          {!canWrite && <p className="text-sm text-slate-600">{t('menu.combo.readOnly')}</p>}

          {needItems ? (
            <p className="text-sm text-slate-600">
              {t('menu.combos.needItems')}{' '}
              <Link to={`/admin/menu/items?brandId=${brandId}`} className="underline">
                {t('menu.combos.goToItems')}
              </Link>
            </p>
          ) : (
            <ComboForm
              key={combo.data?.id ?? 'new'}
              existing={combo.data ?? null}
              brandId={brandId}
              items={items.data ?? []}
              categories={categories.data ?? []}
              readOnly={!canWrite}
            />
          )}
        </>
      )}
    </div>
  );
}
