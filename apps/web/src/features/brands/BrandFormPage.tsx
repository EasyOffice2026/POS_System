import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { BrandActions } from './BrandActions';
import { BrandForm } from './BrandForm';
import { getBrand } from './brands-api';

// Creates a brand, or changes the brand in the address (/admin/brands/:id).
export function BrandFormPage() {
  const { t } = useTranslation();
  const { id } = useParams();

  const existing = useQuery({
    queryKey: ['brand', id],
    queryFn: () => getBrand(id ?? ''),
    enabled: Boolean(id),
  });

  const title = id ? t('brands.editBrand') : t('brands.newBrand');
  const loading = Boolean(id) && existing.isPending;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <Link to="/admin/brands" className="text-sm underline">
          {t('common.back')}
        </Link>
      </div>

      {existing.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {loading && <p className="text-sm text-slate-500">{t('common.loading')}</p>}

      {!existing.isError && !loading && (
        <>
          <BrandForm key={existing.data?.id ?? 'new'} existing={existing.data ?? null} />
          {existing.data && <BrandActions brand={existing.data} />}
        </>
      )}
    </div>
  );
}
