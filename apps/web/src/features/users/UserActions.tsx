import type { AdminUser } from '@pos/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { secondaryButtonClass } from '../../components/form';
import { messageFor, problemsFrom } from '../../lib/error-messages';
import { useAuth } from '../auth/auth-context';
import { StatusBadge } from './StatusBadge';
import { unlockUser, updateUser } from './users-api';

// Deactivate or activate a person, unlock them, and look at what they did.
export function UserActions({ user, isSelf }: { user: AdminUser; isSelf: boolean }) {
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<
    'deactivated' | 'activated' | 'unlocked' | { problem: string } | null
  >(null);

  const canSeeAudit = me?.permissions.includes('audit:read') ?? false;

  async function applied(saved: AdminUser, text: 'deactivated' | 'activated' | 'unlocked') {
    queryClient.setQueryData(['user', saved.id], saved);
    await queryClient.invalidateQueries({ queryKey: ['users'] });
    setMessage(text);
  }

  const toggle = useMutation({
    mutationFn: () => updateUser(user.id, { isActive: !user.isActive }),
    onSuccess: (saved) => applied(saved, saved.isActive ? 'activated' : 'deactivated'),
    onError: (error) => setMessage({ problem: problemsFrom(error).form ?? 'saveError' }),
  });
  const unlock = useMutation({
    mutationFn: () => unlockUser(user.id),
    onSuccess: (saved) => applied(saved, 'unlocked'),
    onError: (error) => setMessage({ problem: problemsFrom(error).form ?? 'saveError' }),
  });

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge user={user} detailed />
        {!isSelf && (
          <button
            type="button"
            disabled={toggle.isPending}
            onClick={() => toggle.mutate()}
            className={secondaryButtonClass}
          >
            {user.isActive ? t('users.actions.deactivate') : t('users.actions.activate')}
          </button>
        )}
        {user.lockedUntil && (
          <button
            type="button"
            disabled={unlock.isPending}
            onClick={() => unlock.mutate()}
            className={secondaryButtonClass}
          >
            {t('users.actions.unlock')}
          </button>
        )}
        {canSeeAudit && (
          <Link to={`/admin/audit?userId=${user.id}`} className="text-sm underline">
            {t('users.actions.viewActivity')}
          </Link>
        )}
      </div>

      {typeof message === 'string' && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {t(`users.messages.${message}`)}
        </p>
      )}
      {typeof message === 'object' && message !== null && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(message.problem, t)}
        </p>
      )}
    </section>
  );
}
