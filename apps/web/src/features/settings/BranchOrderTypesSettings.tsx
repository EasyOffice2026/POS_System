import { type Branch, branchOrderTypes, type OrderTypesSetting } from '@pos/shared';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { primaryButtonClass } from '../../components/form';
import { localize } from '../../i18n/localize';
import { getBranch, updateBranch } from '../branches/branches-api';
import { menuKeys } from '../menu/menu-api';

// Each branch chooses which order types its till offers: a kiosk has no seats, a branch with its
// own drivers takes delivery orders. At least one type stays on
// (docs/specs/026-order-types.md, rule 2).
export function BranchOrderTypesSettings({ branches }: { branches: Branch[] }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const details = useQueries({
    queries: branches.map((branch) => ({
      queryKey: ['branches', 'detail', branch.id],
      queryFn: () => getBranch(branch.id),
    })),
  });
  const saved = new Map(
    details.flatMap((query) => (query.data ? [[query.data.id, query.data.config.orderTypes]] : [])),
  );
  const [changes, setChanges] = useState<Record<string, OrderTypesSetting>>({});
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  const valueOf = (id: string) => changes[id] ?? saved.get(id);
  const toggle = (id: string, type: (typeof branchOrderTypes)[number], on: boolean) => {
    const current = valueOf(id);
    if (!current) return;
    setChanges((all) => ({ ...all, [id]: { ...current, [type]: on } }));
    setState('idle');
  };

  async function save() {
    setState('saving');
    try {
      for (const [id, orderTypes] of Object.entries(changes)) {
        const updated = await updateBranch(id, { config: { orderTypes } });
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
      id="settings-order-types"
      aria-labelledby="settings-order-types-title"
    >
      <h2 id="settings-order-types-title" className="text-lg font-semibold">
        {t('settings.orderTypes.title')}
      </h2>
      <p className="text-sm text-slate-600">{t('settings.orderTypes.intro')}</p>
      <ul className="divide-y divide-slate-100">
        {branches.map((branch) => {
          const value = valueOf(branch.id);
          const name = localize(branch.name, i18n.language);
          const onCount = value ? branchOrderTypes.filter((type) => value[type]).length : 0;
          return (
            <li key={branch.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-2">
              <span className="min-w-40 flex-1 font-medium">{name}</span>
              {value ? (
                branchOrderTypes.map((type) => (
                  <label key={type} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={value[type]}
                      // The last type that is on cannot be switched off.
                      disabled={value[type] && onCount === 1}
                      aria-label={t('settings.orderTypes.of', {
                        type: t(`settings.orderTypes.${type}`),
                        branch: name,
                      })}
                      onChange={(event) => toggle(branch.id, type, event.target.checked)}
                    />
                    {t(`settings.orderTypes.${type}`)}
                  </label>
                ))
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
          {t('settings.orderTypes.save')}
        </button>
        {state === 'saved' && (
          <p role="status" className="text-sm text-emerald-800">
            {t('settings.orderTypes.saved')}
          </p>
        )}
        {state === 'failed' && (
          <p role="alert" className="text-sm text-red-700">
            {t('settings.orderTypes.failed')}
          </p>
        )}
      </div>
    </section>
  );
}
