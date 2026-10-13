import { useTranslation } from 'react-i18next';
import { ShiftGate } from '../shifts/ShiftGate';
import { OrderScreen } from './OrderScreen';
import { TerminalGate } from './TerminalGate';

// The POS terminal: not set up, the PIN screen, the opening of the shift, or the order screen.
// See docs/specs/006-pos-terminal.md, rules 1 to 3, and docs/specs/010-shifts.md.
export function PosPage() {
  const { t } = useTranslation();

  return (
    <TerminalGate
      screen="/pos"
      permission="orders:write"
      denied={(name) => t('pos.notAllowed.noOrders', { name })}
    >
      {(terminal) => (
        <ShiftGate terminal={terminal}>
          {(shift, closeShift) => (
            <OrderScreen terminal={terminal} shift={shift} onCloseShift={closeShift} />
          )}
        </ShiftGate>
      )}
    </TerminalGate>
  );
}
