import { type Branch, type KitchenSettings } from '@pos/shared';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { primaryButtonClass } from '../../components/form';
import { localize } from '../../i18n/localize';
import { getBranch, updateBranch } from '../branches/branches-api';
import { menuKeys } from '../menu/menu-api';

// Each branch chooses whether its orders go to the kitchen screen, and whether the till prints a
// kitchen slip; without the screen the slip always prints
// (docs/specs/027-kitchen-screen-and-slip.md).
export function BranchKitchenSettings({ branches }: { branches: Branch[] }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const details = useQueries({
    queries: branches.map((branch) => ({
      queryKey: ['branches', 'detail', branch.id],
      queryFn: () => getBranch(branch.id),
    })),
  });
  const saved = new Map(
    details.flatMap((query) => (query.data ? [[query.data.id, query.data.config.kitchen]] : [])),
  );
  const [changes, setChanges] = useState<Record<string, KitchenSettings>>({});
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  const valueOf = (id: string) => changes[id] ?? saved.get(id);
  const change = (id: string, next: Partial<KitchenSettings>) => {
    const current = valueOf(id);
    if (!current) return;
    setChanges((all) => ({ ...all, [id]: { ...current, ...next } }));
    setState('idle');
  };

  async function save() {
    setState('saving');
    try {
      for (const [id, kitchen] of Object.entries(changes)) {
        const updated = await updateBranch(id, { config: { kitchen } });
        queryClient.setQueryData(['branches', 'detail', id], updated);
        void queryClient.invalidateQueries({ queryKey: menuKeys.branchMenu(id) });
      }
      setChanges({});
      setState('saved');
    } catch {
      setState('failed');
    }
  }

  const pending = Object.keys(changes).length > 0;

  return (
    <section
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
      aria-labelledby="settings-kitchen-branches"
    >
      <h2 id="settings-kitchen-branches" className="text-lg font-semibold">
        {t('settings.kitchenBranches.title')}
      </h2>
      <p className="text-sm text-slate-600">{t('settings.kitchenBranches.intro')}</p>
      {branches.length === 0 && (
        <p className="text-sm text-slate-500">{t('settings.kitchenBranches.none')}</p>
      )}
      <ul className="divide-y divide-slate-100">
        {branches.map((branch) => {
          const value = valueOf(branch.id);
          const name = localize(branch.name, i18n.language);
          return (
            <li key={branch.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-2">
              <span className="min-w-40 flex-1 font-medium">{name}</span>
              {value ? (
                <>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={value.screen}
                      aria-label={t('settings.kitchenBranches.screenOf', { branch: name })}
                      onChange={(event) => change(branch.id, { screen: event.target.checked })}
                    />
                    {t('settings.kitchenBranches.screen')}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      // Without the screen the slip is the kitchen's only copy.
                      checked={value.slip || !value.screen}
                      disabled={!value.screen}
                      aria-label={t('settings.kitchenBranches.slipOf', { branch: name })}
                      onChange={(event) => change(branch.id, { slip: event.target.checked })}
                    />
                    {value.screen
                      ? t('settings.kitchenBranches.slip')
                      : t('settings.kitchenBranches.slipAlways')}
                  </label>
                </>
              ) : (
                <span className="text-sm text-slate-500">{t('common.loading')}</span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!pending || state === 'saving'}
          onClick={() => void save()}
          className={primaryButtonClass}
        >
          {t('settings.kitchenBranches.save')}
        </button>
        {state === 'saved' && (
          <p role="status" className="text-sm text-emerald-800">
            {t('settings.kitchenBranches.saved')}
          </p>
        )}
        {state === 'failed' && (
          <p role="alert" className="text-sm text-red-700">
            {t('settings.kitchenBranches.failed')}
          </p>
        )}
      </div>
    </section>
  );
}
