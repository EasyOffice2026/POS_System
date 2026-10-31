import { useTranslation } from 'react-i18next';
import { secondaryButtonClass } from '../../components/form';
import type { PrintState } from './use-printing';

interface PrintStatusProps {
  state: PrintState;
  // Printing through the browser instead, offered when the printer did not print.
  onPrintHere: () => void;
}

// How the print is going, under a receipt or in the till's message bar (spec 028, rule 5).
export function PrintStatus({ state, onPrintHere }: PrintStatusProps) {
  const { t } = useTranslation();
  if (state.status === 'idle') return null;

  if (state.status === 'failed') {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-2 text-sm text-red-800"
      >
        <span>
          {state.error
            ? t('pos.printing.failed', { printer: state.printerName, error: state.error })
            : t('pos.printing.noBridge', { printer: state.printerName })}
        </span>
        <button type="button" onClick={onPrintHere} className={secondaryButtonClass}>
          {t('pos.printing.printHere')}
        </button>
      </div>
    );
  }

  return (
    <p role="status" className="text-sm text-slate-600">
      {t(`pos.printing.${state.status}`, { printer: state.printerName })}
    </p>
  );
}
