import type { Brand } from '@pos/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { localize } from '../../i18n/localize';
import { useAuth } from '../auth/auth-context';
import { listBranches, listBrands } from './admin-api';

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-base font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function Message({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'error' }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : undefined}
      className={tone === 'error' ? 'text-sm text-red-700' : 'text-sm text-slate-500'}
    >
      {children}
    </p>
  );
}

function BranchList({ brandId, title }: { brandId: string; title: string }) {
  const { t, i18n } = useTranslation();
  const branches = useQuery({
    queryKey: ['branches', brandId],
    queryFn: () => listBranches(brandId),
  });

  return (
    <Panel title={title}>
      {branches.isPending && <Message>{t('common.loading')}</Message>}
      {branches.isError && <Message tone="error">{t('dashboard.loadError')}</Message>}
      {branches.data?.length === 0 && <Message>{t('dashboard.noBranches')}</Message>}
      <ul className="space-y-1">
        {branches.data?.map((branch) => (
          <li key={branch.id} className="text-sm text-slate-700">
            {localize(branch.name, i18n.language)}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function BrandPanel({ brand }: { brand: Brand }) {
  const { t, i18n } = useTranslation();
  const name = localize(brand.name, i18n.language);

  return <BranchList brandId={brand.id} title={`${name} - ${t('dashboard.branches')}`} />;
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const canListBrands = user?.permissions.includes('brands:read') ?? false;
  const canListBranches = user?.permissions.includes('branches:read') ?? false;
  const brands = useQuery({ queryKey: ['brands'], queryFn: listBrands, enabled: canListBrands });

  if (!user) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('dashboard.title')}</h1>
        <p className="text-slate-600">{t('dashboard.welcome', { name: user.name })}</p>
        <p className="text-sm text-slate-500">
          {t('dashboard.role', { role: t(`roles.${user.role.key}`) })}
        </p>
      </div>

      {canListBrands && (
        <>
          {brands.isPending && <Message>{t('common.loading')}</Message>}
          {brands.isError && <Message tone="error">{t('dashboard.loadError')}</Message>}
          {brands.data?.length === 0 && <Message>{t('dashboard.noBrands')}</Message>}
          <div className="grid gap-4 md:grid-cols-2">
            {brands.data?.map((brand) => (
              <BrandPanel key={brand.id} brand={brand} />
            ))}
          </div>
        </>
      )}

      {/* A person who may read branches but not brands sees the branches of their own brand. */}
      {!canListBrands && canListBranches && user.brandId && (
        <BranchList brandId={user.brandId} title={t('dashboard.branches')} />
      )}

      {!canListBrands && !canListBranches && <Message>{t('dashboard.noAccess')}</Message>}
    </div>
  );
}
