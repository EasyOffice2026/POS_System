import type { ShiftReport, ShiftSummary } from '@pos/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { fieldClass, primaryButtonClass, secondaryButtonClass } from '../../components/form';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import { localize } from '../../i18n/localize';
import { messageFor, problemsFrom } from '../../lib/error-messages';
import { normalizeNumberInput } from '../../lib/numbers';
import { useAuth } from '../auth/auth-context';
import type { Terminal } from '../pos/terminal-store';
import { closeShift, currentShift, getShift, openShift, shiftKeys } from './shifts-api';
import { ShiftReportView } from './ShiftReportView';

interface ShiftGateProps {
  terminal: Terminal;
  // The screen, given the open shift and a way to close it.
  children: (shift: ShiftSummary, closeShift: () => void) => ReactNode;
}

// Before the order screen, the cashier opens a shift with the cash in the drawer; the screen gets
// the shift, and a Close shift button that counts the drawer and shows the report. After closing,
// the opening form comes back. See docs/specs/010-shifts.md.
export function ShiftGate({ terminal, children }: ShiftGateProps) {
  const { t, i18n } = useTranslation();
  const { logout } = useAuth();
  const queryClient = useQueryClient();
  const key = shiftKeys.current(terminal.branchId);
  const current = useQuery({ queryKey: key, queryFn: () => currentShift(terminal.branchId) });

  const [openingCash, setOpeningCash] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const open = useMutation({
    mutationFn: () => openShift({ branchId: terminal.branchId, openingCash: openingCash.trim() }),
    onSuccess: (shift) => {
      queryClient.setQueryData(key, shift);
      setOpeningCash('');
    },
    onError: (error) => {
      const found = problemsFrom(error);
      setProblem(found.fields.openingCash ?? found.form ?? 'saveError');
      // Somebody opened one on another terminal in the meantime.
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  function onOpen(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    open.mutate();
  }

  if (current.isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center text-slate-500">
        {t('common.loading')}
      </main>
    );
  }

  if (current.isError) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {t('common.loadError')}
        </p>
      </main>
    );
  }

  if (!current.data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <form
          onSubmit={onOpen}
          noValidate
          className="w-full max-w-sm space-y-4 rounded-xl bg-white p-6 shadow"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-slate-500">
                {localize(terminal.branchName, i18n.language)}
              </p>
              <h1 className="text-xl font-semibold text-slate-900">{t('shifts.open.title')}</h1>
            </div>
            <LanguageSwitcher />
          </div>
          <p className="text-sm text-slate-600">{t('shifts.open.intro')}</p>
          <label className="block text-sm font-medium text-slate-700">
            {t('shifts.openingCash')}
            <input
              type="text"
              inputMode="decimal"
              dir="ltr"
              autoComplete="off"
              value={openingCash}
              onChange={(event) => setOpeningCash(normalizeNumberInput(event.target.value))}
              className={`${fieldClass} text-lg`}
            />
          </label>
          {problem && (
            <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {messageFor(problem, t)}
            </p>
          )}
          <button
            type="submit"
            disabled={open.isPending || openingCash.trim() === ''}
            className={`${primaryButtonClass} w-full py-3 text-base`}
          >
            {t('shifts.open.submit')}
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            className={`${secondaryButtonClass} w-full`}
          >
            {t('auth.signOut')}
          </button>
        </form>
      </main>
    );
  }

  return (
    <>
      {children(current.data, () => setClosing(true))}
      {closing && (
        <CloseShiftDialog
          shift={current.data}
          onClosed={() => {
            setClosing(false);
            queryClient.setQueryData(key, null);
          }}
          onCancel={() => setClosing(false)}
        />
      )}
    </>
  );
}

interface CloseShiftDialogProps {
  shift: ShiftSummary;
  onClosed: () => void;
  onCancel: () => void;
}

// Counts the drawer, closes the shift and shows the report (rule 5).
export function CloseShiftDialog({ shift, onClosed, onCancel }: CloseShiftDialogProps) {
  const { t } = useTranslation();
  const [countedCash, setCountedCash] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [report, setReport] = useState<ShiftReport | null>(null);
  // The figures as they are now, not as they were when the shift was opened.
  const live = useQuery({ queryKey: shiftKeys.one(shift.id), queryFn: () => getShift(shift.id) });

  const close = useMutation({
    mutationFn: () =>
      closeShift(shift.id, { countedCash: countedCash.trim(), ...(note.trim() ? { note } : {}) }),
    onSuccess: setReport,
    onError: (error) => {
      const found = problemsFrom(error);
      setProblem(found.fields.countedCash ?? found.form ?? 'saveError');
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    close.mutate();
  }

  if (report) {
    return (
      <Dialog title={t('shifts.report.title')} onClose={onClosed}>
        <ShiftReportView shift={report} />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => window.print()} className={secondaryButtonClass}>
            {t('pos.receipt.print')}
          </button>
          <button type="button" onClick={onClosed} className={primaryButtonClass}>
            {t('shifts.report.done')}
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={t('shifts.close.title')} onClose={onCancel}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <ShiftReportView shift={live.data ?? shift} />
        <label className="block text-sm font-medium text-slate-700">
          {t('shifts.countedCash')}
          <input
            type="text"
            inputMode="decimal"
            dir="ltr"
            autoComplete="off"
            value={countedCash}
            onChange={(event) => setCountedCash(normalizeNumberInput(event.target.value))}
            className={`${fieldClass} text-lg`}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          {t('shifts.note')}
          <input
            type="text"
            dir="auto"
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={fieldClass}
          />
        </label>
        {problem && (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {messageFor(problem, t)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={close.isPending || countedCash.trim() === ''}
            className={primaryButtonClass}
          >
            {t('shifts.close.submit')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
