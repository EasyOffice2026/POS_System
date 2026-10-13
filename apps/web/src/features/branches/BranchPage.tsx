import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { ActiveBadge } from '../../components/ActiveBadge';
import { localize } from '../../i18n/localize';
import { useDirectory } from '../admin/use-directory';
import { useAuth } from '../auth/auth-context';
import { BranchActions } from './BranchActions';
import { BranchDetailsForm } from './BranchDetailsForm';
import { getBranch } from './branches-api';
import { OpeningHoursEditor } from './OpeningHoursEditor';
import { PrintersEditor } from './PrintersEditor';

const tabs = ['details', 'hours', 'printers'] as const;
type Tab = (typeof tabs)[number];

// The settings of one branch, in tabs: details, opening hours and printers. The tab is in the
// address (?tab=hours), so a link, a reload or the back button keep it. A person without
// branches:write can look at everything but change nothing.
export function BranchPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const { user: me } = useAuth();
  const [searchParams] = useSearchParams();
  // Set by the form after it creates a branch.
  const created = (useLocation().state as { notice?: string } | null)?.notice === 'created';
  const directory = useDirectory();

  const branch = useQuery({
    queryKey: ['branch', id],
    queryFn: () => getBranch(id ?? ''),
    enabled: Boolean(id),
  });

  const canWrite = me?.permissions.includes('branches:write') ?? false;
  const requested = searchParams.get('tab');
  const tab: Tab = tabs.find((name) => name === requested) ?? 'details';
  const brand = directory.brands.find((item) => item.id === branch.data?.brandId);

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {branch.data ? localize(branch.data.name, i18n.language) : t('branches.editBranch')}
          </h1>
          {branch.data && (
            <p className="mt-1 flex items-center gap-2 text-sm text-slate-600">
              {brand && <span>{localize(brand.name, i18n.language)}</span>}
              <ActiveBadge isActive={branch.data.isActive} />
            </p>
          )}
        </div>
        <Link
          to={branch.data ? `/admin/branches?brandId=${branch.data.brandId}` : '/admin/branches'}
          className="text-sm underline"
        >
          {t('common.back')}
        </Link>
      </div>

      {branch.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {branch.isPending && Boolean(id) && (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      )}

      {branch.data && me && (
        <>
          {created && (
            <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
              {t('branches.created')}
            </p>
          )}
          {!canWrite && <p className="text-sm text-slate-600">{t('branches.readOnly')}</p>}

          <nav
            aria-label={t('branches.tabs.label')}
            className="flex flex-wrap gap-1 border-b border-slate-200"
          >
            {tabs.map((name) => (
              <Link
                key={name}
                to={{ search: name === 'details' ? '' : `?tab=${name}` }}
                replace
                aria-current={name === tab ? 'page' : undefined}
                className={`-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium ${
                  name === tab
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {t(`branches.tabs.${name}`)}
              </Link>
            ))}
          </nav>

          {tab === 'details' && (
            <div className="space-y-4">
              <BranchDetailsForm
                key={branch.data.id}
                existing={branch.data}
                me={me}
                brands={directory.brands}
                initialBrandId=""
                readOnly={!canWrite}
              />
              {canWrite && <BranchActions branch={branch.data} />}
            </div>
          )}
          {tab === 'hours' && (
            <OpeningHoursEditor key={branch.data.id} branch={branch.data} readOnly={!canWrite} />
          )}
          {tab === 'printers' && (
            <PrintersEditor key={branch.data.id} branch={branch.data} readOnly={!canWrite} />
          )}
        </>
      )}
    </div>
  );
}
