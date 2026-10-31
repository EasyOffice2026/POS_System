import type { Order } from '@pos/shared';
import { useTranslation } from 'react-i18next';
import { kitchenSlipDocument } from './print-document';
import { PrintDocumentView } from './PrintDocumentView';
import type { Terminal } from './terminal-store';

interface KitchenSlipProps {
  order: Order;
  // The dishes sent at this moment; the slip lists only these.
  lineIds: string[];
  terminal: Terminal;
}

// The slip handed to the kitchen, as the lines of print-document.ts say
// (docs/specs/027-kitchen-screen-and-slip.md, rule 4).
export function KitchenSlip({ order, lineIds, terminal }: KitchenSlipProps) {
  const { t, i18n } = useTranslation();
  return (
    <PrintDocumentView
      document={kitchenSlipDocument(order, lineIds, terminal, { t, language: i18n.language })}
    />
  );
}
