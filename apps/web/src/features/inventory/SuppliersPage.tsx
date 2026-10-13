import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { ActiveBadge } from '../../components/ActiveBadge';
import { fieldClass, primaryButtonClass } from '../../components/form';
import { listSuppliers, supplierKeys } from './inventory-api';
import { useInventoryContext } from './InventoryLayout';
import { SupplierForm } from './SupplierForm';

// The brand's suppliers, searched by name, and the way to add one.
// See docs/specs/017-suppliers.md.
export function SuppliersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // A group admin's brand is in the address; the links keep it.
  const { search } = useLocation();
  const { brandId, canEditSuppliers } = useInventoryContext();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);

  const suppliers = useQuery({
    queryKey: supplierKeys.list(brandId, q.trim()),
    queryFn: () => listSuppliers(brandId, q.trim()),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('inventory.suppliers.intro')}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm font-medium text-slate-700">
          {t('inventory.suppliers.search')}
          <input
            type="search"
            dir="auto"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            className={fieldClass}
          />
        </label>
        {canEditSuppliers && !adding && (
          <button type="button" onClick={() => setAdding(true)} className={primaryButtonClass}>
            {t('inventory.suppliers.add')}
          </button>
        )}
      </div>

      {adding && (
        <SupplierForm
          brandId={brandId}
          existing={null}
          onDone={(saved) => {
            setAdding(false);
            if (saved) void navigate({ pathname: saved.id, search });
          }}
        />
      )}

      {suppliers.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {suppliers.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {suppliers.data?.length === 0 && (
        <p className="text-sm text-slate-500">{t('inventory.suppliers.empty')}</p>
      )}

      <ul className="space-y-2">
        {suppliers.data?.map((supplier) => (
          <li
            key={supplier.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"
          >
            <div className="min-w-0">
              <Link
                to={{ pathname: supplier.id, search }}
                className="font-medium underline-offset-2 hover:underline"
              >
                <bdi>{supplier.name}</bdi>
              </Link>
              <p className="text-xs text-slate-600">
                {supplier.phone && (
                  <>
                    <bdi dir="ltr">{supplier.phone}</bdi> ·{' '}
                  </>
                )}
                {supplier.paymentDays === 0
                  ? t('inventory.suppliers.cash')
                  : t('inventory.suppliers.days', { count: supplier.paymentDays })}{' '}
                · {t('inventory.suppliers.priceCount', { count: supplier.priceCount })}
              </p>
            </div>
            <ActiveBadge isActive={supplier.isActive} />
          </li>
        ))}
      </ul>
    </div>
  );
}
