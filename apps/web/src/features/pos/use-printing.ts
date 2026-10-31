import {
  type BranchMenu,
  type MenuPrinter,
  PRINT_JOB_WAIT_SECONDS,
  type PrintJobKind,
  printerKindFor,
} from '@pos/shared';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api';
import type { PrintDocument } from './print-document';
import { renderPrintImage } from './print-image';
import { createPrintJob, getPrintJob } from './printing-api';

// How a print of one kind is going, for the cashier to see (docs/specs/028-print-bridge.md,
// rule 5). Nothing is shown while the browser prints.
export type PrintState =
  | { status: 'idle' }
  | { status: 'sending' | 'queued' | 'printing' | 'done'; printerName: string }
  | { status: 'failed'; printerName: string; error: string | null };

export const POLL_MS = 1000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Printing from the till: to the printer of the branch through the bridge when the branch has
// one of the kind needed, through the browser otherwise.
export function usePrinting(menu: BranchMenu | undefined, branchId: string) {
  const { i18n } = useTranslation();
  const [states, setStates] = useState<Partial<Record<PrintJobKind, PrintState>>>({});
  // So a slip and a receipt sent one after the other do not cancel each other's status.
  const runs = useRef<Partial<Record<PrintJobKind, number>>>({});

  const printerFor = useCallback(
    (kind: PrintJobKind): MenuPrinter | null =>
      menu?.printers.find((printer) => printer.kind === printerKindFor(kind)) ?? null,
    [menu],
  );

  const stateOf = (kind: PrintJobKind): PrintState => states[kind] ?? { status: 'idle' };

  const reset = useCallback((kind: PrintJobKind) => {
    setStates((current) => ({ ...current, [kind]: { status: 'idle' } }));
  }, []);

  // Leaves the document for the bridge and follows it until it printed, failed, or nobody took
  // it in time; or prints through the browser when the branch has no such printer.
  const print = useCallback(
    async (
      kind: PrintJobKind,
      document: PrintDocument,
      orderNumber: number,
      fallback: () => void,
    ): Promise<void> => {
      const printer = printerFor(kind);
      if (!printer) {
        fallback();
        return;
      }
      const run = (runs.current[kind] ?? 0) + 1;
      runs.current[kind] = run;
      const update = (state: PrintState) => {
        if (runs.current[kind] === run) setStates((current) => ({ ...current, [kind]: state }));
      };
      const printerName = printer.name;
      update({ status: 'sending', printerName });

      try {
        const image = await renderPrintImage(document, { direction: i18n.dir() });
        const job = await createPrintJob({
          branchId,
          printerId: printer.id,
          kind,
          orderNumber,
          image,
        });
        update({ status: 'queued', printerName });

        const deadline = Date.now() + PRINT_JOB_WAIT_SECONDS * 1000;
        while (Date.now() < deadline && runs.current[kind] === run) {
          await sleep(POLL_MS);
          const current = await getPrintJob(job.id);
          if (current.status === 'done') {
            update({ status: 'done', printerName });
            return;
          }
          if (current.status === 'failed') {
            update({ status: 'failed', printerName, error: current.error });
            return;
          }
          if (current.status === 'printing') update({ status: 'printing', printerName });
        }
        // Nobody took the job: the bridge is not running.
        update({ status: 'failed', printerName, error: null });
      } catch (error) {
        update({
          status: 'failed',
          printerName,
          error: error instanceof ApiError ? error.message : null,
        });
      }
    },
    [branchId, i18n, printerFor],
  );

  return { print, stateOf, reset, hasPrinter: (kind: PrintJobKind) => printerFor(kind) !== null };
}

export type Printing = ReturnType<typeof usePrinting>;
