import type { BranchDetail } from '@pos/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActiveBadge } from '../../components/ActiveBadge';
import { secondaryButtonClass } from '../../components/form';
import { messageFor, problemsFrom } from '../../lib/error-messages';
import { updateBranch } from './branches-api';

// Deactivate or activate a branch. A branch is never deleted: it keeps its people and history, and
// only the sign-in with a PIN at its terminals stops.
export function BranchActions({ branch }: { branch: BranchDetail }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<'deactivated' | 'activated' | { problem: string } | null>(
    null,
  );

  const toggle = useMutation({
    mutationFn: () => updateBranch(branch.id, { isActive: !branch.isActive }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(['branch', saved.id], saved);
      await queryClient.invalidateQueries({ queryKey: ['branches'] });
      setMessage(saved.isActive ? 'activated' : 'deactivated');
    },
    onError: (error) =>
      setMessage({
        problem: problemsFrom(error, { notFound: 'ITEM_NOT_FOUND' }).form ?? 'saveError',
      }),
  });

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <ActiveBadge isActive={branch.isActive} />
        <button
          type="button"
          disabled={toggle.isPending}
          onClick={() => toggle.mutate()}
          className={secondaryButtonClass}
        >
          {branch.isActive ? t('branches.actions.deactivate') : t('branches.actions.activate')}
        </button>
      </div>

      <p className="text-xs text-slate-500">{t('branches.deactivateHint')}</p>

      {typeof message === 'string' && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {t(`branches.messages.${message}`)}
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
