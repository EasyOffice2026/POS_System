import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { listRoles } from '../roles/roles-api';
import { useDirectory } from '../admin/use-directory';
import { useAuth } from '../auth/auth-context';
import { CredentialsPanel } from './CredentialsPanel';
import { UserActions } from './UserActions';
import { UserForm } from './UserForm';
import { getUser } from './users-api';

// Creates a person, or edits the person in the address (/admin/users/:id).
export function UserFormPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { user: me } = useAuth();

  const roles = useQuery({ queryKey: ['roles'], queryFn: listRoles });
  const directory = useDirectory();
  const existing = useQuery({
    queryKey: ['user', id],
    queryFn: () => getUser(id ?? ''),
    enabled: Boolean(id),
  });

  const title = id ? t('users.editUser') : t('users.newUser');
  const failed = roles.isError || existing.isError;
  const loading = roles.isPending || directory.isLoading || (Boolean(id) && existing.isPending);

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <Link to="/admin/users" className="text-sm underline">
          {t('common.back')}
        </Link>
      </div>

      {failed && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {!failed && loading && <p className="text-sm text-slate-500">{t('common.loading')}</p>}

      {!failed && !loading && me && roles.data && (
        <>
          <UserForm
            key={existing.data?.id ?? 'new'}
            existing={existing.data ?? null}
            me={me}
            roles={roles.data}
            brands={directory.brands}
            branches={directory.branches}
          />
          {existing.data && (
            <>
              <UserActions user={existing.data} isSelf={existing.data.id === me.id} />
              <CredentialsPanel key={existing.data.id} user={existing.data} />
            </>
          )}
        </>
      )}
    </div>
  );
}
