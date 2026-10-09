import type { MenuItemDetail } from '@pos/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActiveBadge } from '../../components/ActiveBadge';
import { secondaryButtonClass } from '../../components/form';
import { messageFor, problemsFrom } from '../../lib/error-messages';
import { menuKeys, updateItem } from './menu-api';

// Deactivate or activate an item. An item is never deleted: old orders keep its name and price,
// and it only stops being sold.
export function ItemActions({ item }: { item: MenuItemDetail }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<'deactivated' | 'activated' | { problem: string } | null>(
    null,
  );

  const toggle = useMutation({
    mutationFn: () => updateItem(item.id, { isActive: !item.isActive }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(menuKeys.item(saved.id), saved);
      await queryClient.invalidateQueries({ queryKey: ['menu', saved.brandId] });
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
        <ActiveBadge isActive={item.isActive} />
        <button
          type="button"
          disabled={toggle.isPending}
          onClick={() => toggle.mutate()}
          className={secondaryButtonClass}
        >
          {item.isActive ? t('menu.item.actions.deactivate') : t('menu.item.actions.activate')}
        </button>
      </div>

      <p className="text-xs text-slate-500">{t('menu.item.deactivateHint')}</p>

      {typeof message === 'string' && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {t(`menu.item.messages.${message}`)}
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
