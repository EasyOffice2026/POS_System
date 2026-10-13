import { useTranslation } from 'react-i18next';
import { TerminalGate } from '../pos/TerminalGate';
import { KitchenScreen } from './KitchenScreen';

// The kitchen display of a terminal: set up and signed in like the POS. Everybody who can see
// orders can look; only people with kitchen:write get the buttons. See
// docs/specs/008-kitchen-display.md, rule 9.
export function KdsPage() {
  const { t } = useTranslation();

  return (
    <TerminalGate
      screen="/kds"
      permission="orders:read"
      denied={(name) => t('kds.notAllowed', { name })}
    >
      {(terminal) => <KitchenScreen terminal={terminal} />}
    </TerminalGate>
  );
}
