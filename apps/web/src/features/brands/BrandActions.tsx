import type { Brand } from '@pos/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ActiveBadge } from '../../components/ActiveBadge';
import { secondaryButtonClass } from '../../components/form';
import { messageFor, problemsFrom } from '../../lib/error-messages';
import { useAuth } from '../auth/auth-context';
import { updateBrand } from './brands-api';

// Deactivate or activate a brand, and go to its branches. A brand is never deleted.
export function BrandActions({ brand }: { brand: Brand }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<'deactivated' | 'activated' | { problem: string } | null>(
    null,
  );

  const canSeeBranches = user?.permissions.includes('branches:read') ?? false;

  const toggle = useMutation({
    mutationFn: () => updateBrand(brand.id, { isActive: !brand.isActive }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(['brand', saved.id], saved);
      await queryClient.invalidateQueries({ queryKey: ['brands'] });
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
        <ActiveBadge isActive={brand.isActive} />
        <button
          type="button"
          disabled={toggle.isPending}
          onClick={() => toggle.mutate()}
          className={secondaryButtonClass}
        >
          {brand.isActive ? t('brands.actions.deactivate') : t('brands.actions.activate')}
        </button>
        {canSeeBranches && (
          <Link to={`/admin/branches?brandId=${brand.id}`} className="text-sm underline">
            {t('brands.actions.viewBranches')}
          </Link>
        )}
      </div>

      <p className="text-xs text-slate-500">{t('brands.deactivateHint')}</p>

      {typeof message === 'string' && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {t(`brands.messages.${message}`)}
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
