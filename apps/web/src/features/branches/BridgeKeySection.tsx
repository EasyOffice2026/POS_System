import type { PrintBridgeKey } from '@pos/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fieldClass, secondaryButtonClass } from '../../components/form';
import { formatDateTime } from '../../i18n/format';
import { messageFor, problemsFrom } from '../../lib/error-messages';
import { createBridgeKey, getBridgeKeyInfo } from './branches-api';

// The key the branch's print bridge signs in with (docs/specs/028-print-bridge.md, rule 4): made
// here, shown once, and replaced by the next one.
export function BridgeKeySection({ branchId, readOnly }: { branchId: string; readOnly: boolean }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [shown, setShown] = useState<PrintBridgeKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const info = useQuery({
    queryKey: ['branch', branchId, 'print-bridge-key'],
    queryFn: () => getBridgeKeyInfo(branchId),
    enabled: !readOnly,
  });

  const create = useMutation({
    mutationFn: () => createBridgeKey(branchId),
    onSuccess: async (key) => {
      setShown(key);
      setCopied(false);
      setProblem(null);
      await queryClient.invalidateQueries({ queryKey: ['branch', branchId, 'print-bridge-key'] });
    },
    onError: (error) => setProblem(problemsFrom(error).form),
  });

  if (readOnly) return null;

  const since = shown?.createdAt ?? info.data?.createdAt ?? null;

  return (
    <section
      aria-labelledby="print-bridge-title"
      className="space-y-3 border-t border-slate-200 pt-4"
    >
      <h3 id="print-bridge-title" className="font-semibold text-slate-900">
        {t('printers.bridge.title')}
      </h3>
      <p className="text-sm text-slate-600">{t('printers.bridge.intro')}</p>

      {info.isSuccess && (
        <p className="text-sm text-slate-700">
          {since
            ? t('printers.bridge.keySince', { date: formatDateTime(since, i18n.language) })
            : t('printers.bridge.noKey')}
        </p>
      )}

      {shown && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <label htmlFor="print-bridge-key" className="block text-sm font-semibold text-slate-900">
            {t('printers.bridge.key')}
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="print-bridge-key"
              type="text"
              readOnly
              dir="ltr"
              value={shown.key}
              onFocus={(event) => event.target.select()}
              className={`${fieldClass} min-w-0 flex-1 font-mono text-xs`}
            />
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(shown.key).then(() => setCopied(true));
              }}
              className={secondaryButtonClass}
            >
              {t('printers.bridge.copy')}
            </button>
          </div>
          <p className="text-sm text-amber-900">
            {copied ? t('printers.bridge.copied') : t('printers.bridge.shownOnce')}
          </p>
          <p className="text-sm text-slate-700">{t('printers.bridge.howTo')}</p>
        </div>
      )}

      {problem && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(problem, t)}
        </p>
      )}

      <button
        type="button"
        onClick={() => create.mutate()}
        disabled={create.isPending}
        className={secondaryButtonClass}
      >
        {since ? t('printers.bridge.replace') : t('printers.bridge.create')}
      </button>
    </section>
  );
}
