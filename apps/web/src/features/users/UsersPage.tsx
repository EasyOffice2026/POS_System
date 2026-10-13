import { type RoleKey, roleKeys, type UserStatus, userStatuses } from '@pos/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { formatDateTime } from '../../i18n/format';
import { localize } from '../../i18n/localize';
import { useDirectory } from '../admin/use-directory';
import { useAuth } from '../auth/auth-context';
import { StatusBadge } from './StatusBadge';
import { listUsersPage, type UserFilters } from './users-api';

const fieldClass =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-start focus:ring-2 focus:ring-slate-400 focus:outline-none';

export function UsersPage() {
  const { t, i18n } = useTranslation();
  const { user: me } = useAuth();
  const canWrite = me?.permissions.includes('users:write') ?? false;
  // Set by the form after it creates somebody.
  const created = (useLocation().state as { notice?: string } | null)?.notice === 'created';

  const [search, setSearch] = useState('');
  const [role, setRole] = useState<RoleKey | ''>('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const query = useDeferredValue(search.trim());

  const filters: UserFilters = {
    ...(role ? { role } : {}),
    ...(status ? { status } : {}),
    ...(query ? { q: query } : {}),
  };

  const users = useInfiniteQuery({
    queryKey: ['users', filters],
    queryFn: ({ pageParam }) => listUsersPage(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const directory = useDirectory();

  const rows = users.data?.pages.flatMap((page) => page.data) ?? [];
  const branchNames = new Map(
    directory.branches.map((branch) => [branch.id, localize(branch.name, i18n.language)]),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('users.title')}</h1>
        {canWrite && (
          <Link
            to="/admin/users/new"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:outline-none"
          >
            {t('users.newUser')}
          </Link>
        )}
      </div>

      {created && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {t('users.messages.created')}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-medium text-slate-700">
          {t('users.search')}
          <input
            type="search"
            dir="auto"
            value={search}
            placeholder={t('users.searchPlaceholder')}
            onChange={(event) => setSearch(event.target.value)}
            className={fieldClass}
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          {t('users.filterRole')}
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as RoleKey | '')}
            className={fieldClass}
          >
            <option value="">{t('common.all')}</option>
            {roleKeys.map((key) => (
              <option key={key} value={key}>
                {t(`roles.${key}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium text-slate-700">
          {t('users.filterStatus')}
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as UserStatus | '')}
            className={fieldClass}
          >
            <option value="">{t('common.all')}</option>
            {userStatuses.map((key) => (
              <option key={key} value={key}>
                {t(`users.status.${key}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {users.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {users.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {users.isSuccess && rows.length === 0 && (
        <p className="text-sm text-slate-500">{t('users.empty')}</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-start text-sm whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('users.columns.name')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('users.columns.role')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('users.columns.signIn')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('users.columns.branches')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('users.columns.status')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('users.columns.lastSignIn')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 font-medium text-slate-900">
                    {canWrite ? (
                      <Link to={`/admin/users/${row.id}`} className="underline">
                        {row.name}
                      </Link>
                    ) : (
                      row.name
                    )}
                  </td>
                  <td className="px-3 py-2">{t(`roles.${row.role.key}`)}</td>
                  <td className="px-3 py-2 text-slate-700" dir="auto">
                    {row.email && <div>{row.email}</div>}
                    {row.staffCode && <div>{row.staffCode}</div>}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {row.branchIds.length > 0
                      ? row.branchIds.map((id) => branchNames.get(id) ?? '…').join(', ')
                      : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge user={row} />
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {row.lastLoginAt
                      ? formatDateTime(row.lastLoginAt, i18n.language)
                      : t('users.never')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {users.hasNextPage && (
        <button
          type="button"
          disabled={users.isFetchingNextPage}
          onClick={() => void users.fetchNextPage()}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:ring-2 focus:ring-slate-400 focus:outline-none disabled:opacity-60"
        >
          {users.isFetchingNextPage ? t('common.loading') : t('common.loadMore')}
        </button>
      )}
    </div>
  );
}
