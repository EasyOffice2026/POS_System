import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useDirectory } from '../admin/use-directory';
import { useAuth } from '../auth/auth-context';
import { BranchDetailsForm } from './BranchDetailsForm';

// Creates a branch. The brand comes from the address (?brandId=) when the person came from the
// list of one brand. A group admin can still choose another.
export function BranchFormPage() {
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const [searchParams] = useSearchParams();
  const directory = useDirectory();

  const brandId = searchParams.get('brandId') ?? '';

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('branches.newBranch')}</h1>
        <Link
          to={brandId ? `/admin/branches?brandId=${brandId}` : '/admin/branches'}
          className="text-sm underline"
        >
          {t('common.back')}
        </Link>
      </div>

      {directory.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {directory.isLoading && <p className="text-sm text-slate-500">{t('common.loading')}</p>}

      {me && !directory.isLoading && !directory.isError && (
        <BranchDetailsForm
          existing={null}
          me={me}
          brands={directory.brands}
          initialBrandId={brandId}
          readOnly={false}
        />
      )}
    </div>
  );
}
