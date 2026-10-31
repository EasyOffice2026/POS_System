import type { Order } from '@pos/shared';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';
import { Printer, SquarePlus } from 'lucide-react';
import { primaryButtonClass, secondaryButtonClass } from '../../components/form';
import { receiptDocument } from './print-document';
import { PrintDocumentView } from './PrintDocumentView';
import { PrintStatus } from './PrintStatus';
import type { Terminal } from './terminal-store';
import type { PrintState } from './use-printing';

interface ReceiptProps {
  order: Order;
  terminal: Terminal;
  cashier: string;
  // The bill of an order not paid yet, printed for the table (docs/specs/023-floor-plan.md).
  bill?: boolean;
}

// What was sold and how it was paid, as the lines of print-document.ts say. See
// docs/specs/007-payments.md, rule 9.
export function Receipt({ order, terminal, cashier, bill = false }: ReceiptProps) {
  const { t, i18n } = useTranslation();
  return (
    <PrintDocumentView
      document={receiptDocument(order, terminal, cashier, bill, { t, language: i18n.language })}
    />
  );
}

// Printing from a dialog: through the bridge, with how it is going, or through the browser.
interface PrintingProps {
  onPrint: () => void;
  printState: PrintState;
  onPrintHere: () => void;
}

interface ReceiptDialogProps extends ReceiptProps, PrintingProps {
  onNewOrder: () => void;
  onClose: () => void;
}

interface BillDialogProps extends ReceiptProps, PrintingProps {
  onClose: () => void;
}

// The bill of a table before it pays, with a button to print it (spec 023, rule 6).
export function BillDialog({
  onClose,
  onPrint,
  printState,
  onPrintHere,
  ...receipt
}: BillDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog title={t('pos.table.billTitle')} onClose={onClose}>
      <Receipt {...receipt} bill />
      <div className="mt-3">
        <PrintStatus state={printState} onPrintHere={onPrintHere} />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={secondaryButtonClass}>
          {t('common.back')}
        </button>
        <button type="button" onClick={onPrint} className={primaryButtonClass}>
          <Printer aria-hidden="true" />
          {t('pos.receipt.print')}
        </button>
      </div>
    </Dialog>
  );
}

// The receipt after payment, with a button to print it: on the branch's receipt printer, or on
// any printer the browser knows.
export function ReceiptDialog({
  onNewOrder,
  onClose,
  onPrint,
  printState,
  onPrintHere,
  ...receipt
}: ReceiptDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog title={t('pos.receipt.title')} onClose={onClose}>
      <Receipt {...receipt} />
      <div className="mt-3">
        <PrintStatus state={printState} onPrintHere={onPrintHere} />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onPrint} className={secondaryButtonClass}>
          <Printer aria-hidden="true" />
          {t('pos.receipt.print')}
        </button>
        <button type="button" onClick={onNewOrder} className={primaryButtonClass}>
          <SquarePlus aria-hidden="true" />
          {t('pos.order.newOrder')}
        </button>
      </div>
    </Dialog>
  );
}
