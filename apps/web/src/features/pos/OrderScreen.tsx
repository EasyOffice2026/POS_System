import { defaultBrandSettings, type Order, type OrderLine, type ShiftSummary } from '@pos/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import { localize } from '../../i18n/localize';
import { useAuth } from '../auth/auth-context';
import { getBranchMenu, menuKeys } from '../menu/menu-api';
import { useNow } from '../menu/use-now';
import { ApprovalDialog } from './ApprovalDialog';
import { type Choosing, ChoiceDialog } from './ChoiceDialog';
import { DiscountDialog } from './DiscountDialog';
import { MenuPanel } from './MenuPanel';
import { OpenOrdersDialog } from './OpenOrdersDialog';
import { OrderPanel } from './OrderPanel';
import { PaymentDialog } from './PaymentDialog';
import { Receipt, ReceiptDialog } from './Receipt';
import { RefundDialog } from './RefundDialog';
import { useBrandSettings } from '../settings/settings-api';

// How often a terminal asks for the brand's settings again (spec 009, rule 8).
export const SETTINGS_REFRESH_MS = 180_000;
import type { Terminal } from './terminal-store';
import { useTerminalOrder } from './use-terminal-order';
import { VoidDialog } from './VoidDialog';

type Voiding = { kind: 'line'; line: OrderLine } | { kind: 'order' };

const headerButtonClass =
  'rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:ring-2 focus:ring-slate-400 focus:outline-none';

// The screen a cashier takes orders on: the menu of the branch, and the order being taken.
// See docs/specs/006-pos-terminal.md.
interface OrderScreenProps {
  terminal: Terminal;
  // The cashier's open shift, which every payment goes into (spec 010).
  shift: ShiftSummary;
  onCloseShift: () => void;
}

export function OrderScreen({ terminal, shift, onCloseShift }: OrderScreenProps) {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const now = useNow();
  const terminalOrder = useTerminalOrder(terminal.branchId, terminal.brandId);
  // The brand's settings: ways to pay, discount buttons, who marks dishes done (spec 009).
  const settings = useBrandSettings(terminal.brandId, SETTINGS_REFRESH_MS);
  const brandSettings = settings.data ?? defaultBrandSettings;
  const { order, busy, notice } = terminalOrder;

  const [choosing, setChoosing] = useState<Choosing | null>(null);
  const [voiding, setVoiding] = useState<Voiding | null>(null);
  const [discounting, setDiscounting] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [listing, setListing] = useState(false);
  const [paying, setPaying] = useState(false);
  // The paid order whose receipt is shown, and printed.
  const [receipt, setReceipt] = useState<Order | null>(null);

  const menu = useQuery({
    queryKey: menuKeys.branchMenu(terminal.branchId),
    queryFn: () => getBranchMenu(terminal.branchId),
  });

  const timeFormat = new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-u-nu-latn' : 'en-GB', {
    timeStyle: 'short',
    hourCycle: 'h23',
  });
  const clock = timeFormat.format(now);
  const timeOf = (iso: string) => timeFormat.format(new Date(iso));

  function pick(next: Choosing) {
    // A dish without choices goes straight onto the order.
    if (next.kind === 'item' && next.item.modifierGroups.length === 0) {
      void terminalOrder.add({ kind: 'item', itemId: next.item.id, quantity: 1, modifierIds: [] });
    } else {
      setChoosing(next);
    }
  }

  const noticeText = () => {
    if (!notice) return '';
    if (notice.code === 'refunded') {
      return t('pos.notices.refunded', { number: notice.number ?? 0, amount: notice.amount ?? '' });
    }
    if (notice.code === 'orderVoided') {
      return t('pos.notices.orderVoided', { number: notice.number ?? 0 });
    }
    return t(`pos.errors.${notice.code}`);
  };

  const cashier = user?.name ?? '';

  return (
    <>
      <div className="flex min-h-screen flex-col bg-slate-100 text-slate-900 print:hidden lg:h-screen">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">
              {terminal.brandName ? localize(terminal.brandName, i18n.language) : t('app.name')}
            </p>
            <p className="font-semibold">{localize(terminal.branchName, i18n.language)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium" dir="ltr">
              {clock}
            </span>
            <span className="text-sm text-slate-600">{user?.name}</span>
            <button type="button" onClick={() => setListing(true)} className={headerButtonClass}>
              {t('pos.openOrders.button')}
            </button>
            <button
              type="button"
              onClick={onCloseShift}
              className={headerButtonClass}
              title={t('pos.shift.since', { time: timeOf(shift.openedAt) })}
            >
              {t('pos.shift.close')}
            </button>
            <LanguageSwitcher />
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-md bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-700"
            >
              {t('auth.signOut')}
            </button>
          </div>
        </header>

        {notice && (
          <div
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={`flex items-center justify-between gap-3 px-4 py-2 text-sm ${
              notice.kind === 'error' ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-900'
            }`}
          >
            <span>{noticeText()}</span>
            <button
              type="button"
              onClick={terminalOrder.dismissNotice}
              aria-label={t('pos.notices.dismiss')}
              className="rounded px-2 font-semibold"
            >
              ×
            </button>
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="min-h-0 overflow-y-auto">
            {menu.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
            {menu.isError && (
              <p role="alert" className="text-sm text-red-700">
                {t('common.loadError')}
              </p>
            )}
            {menu.data && <MenuPanel menu={menu.data} now={now} disabled={busy} onPick={pick} />}
          </div>

          <OrderPanel
            order={order}
            type={terminalOrder.type}
            busy={busy}
            onType={terminalOrder.setType}
            onQuantity={terminalOrder.setQuantity}
            onVoidLine={(line) => setVoiding({ kind: 'line', line })}
            onSend={terminalOrder.send}
            onDiscount={() => setDiscounting(true)}
            onRefund={() => setRefunding(true)}
            onVoidOrder={() => setVoiding({ kind: 'order' })}
            onNewOrder={terminalOrder.newOrder}
            onPay={() => setPaying(true)}
            canMarkDone={brandSettings.ticketDoneBy === 'cashier'}
            onMarkDone={terminalOrder.markDone}
          />
        </div>

        {choosing && menu.data && (
          <ChoiceDialog
            choosing={choosing}
            menu={menu.data}
            now={now}
            onCancel={() => setChoosing(null)}
            onAdd={(line) => {
              setChoosing(null);
              void terminalOrder.add(line);
            }}
          />
        )}

        {voiding && (
          <VoidDialog
            what={
              voiding.kind === 'line'
                ? `${localize(voiding.line.name, i18n.language)} × ${voiding.line.quantity}`
                : t('pos.order.number', { number: order?.number ?? 0 })
            }
            onCancel={() => setVoiding(null)}
            onConfirm={(reason) => {
              setVoiding(null);
              if (voiding.kind === 'line') terminalOrder.voidLine(voiding.line, reason);
              else terminalOrder.voidOrder(reason);
            }}
          />
        )}

        {refunding && order && (
          <RefundDialog
            order={order}
            onCancel={() => setRefunding(false)}
            onConfirm={(input) => {
              setRefunding(false);
              terminalOrder.refund(input);
            }}
          />
        )}

        {discounting && order && (
          <DiscountDialog
            order={order}
            presets={brandSettings.discountPresets}
            onCancel={() => setDiscounting(false)}
            onApply={(input) => {
              setDiscounting(false);
              terminalOrder.setDiscount(input);
            }}
            onRemove={() => {
              setDiscounting(false);
              terminalOrder.removeDiscount();
            }}
          />
        )}

        {listing && (
          <OpenOrdersDialog
            branchId={terminal.branchId}
            currentId={order?.id ?? null}
            onClose={() => setListing(false)}
            onOpen={(id) => {
              setListing(false);
              terminalOrder.open(id);
            }}
          />
        )}

        {terminalOrder.approval && (
          <ApprovalDialog
            change={terminalOrder.approval}
            onDone={terminalOrder.approvalDone}
            onFailed={terminalOrder.approvalFailed}
            onCancel={terminalOrder.approvalCancelled}
          />
        )}

        {paying && order && (
          <PaymentDialog
            order={order}
            settings={brandSettings}
            onCancel={() => setPaying(false)}
            onPay={(tenders) => {
              setPaying(false);
              void terminalOrder.pay(tenders).then((paid) => {
                if (paid) setReceipt(paid);
              });
            }}
          />
        )}

        {receipt && (
          <ReceiptDialog
            order={receipt}
            terminal={terminal}
            cashier={cashier}
            onClose={() => setReceipt(null)}
            onNewOrder={() => {
              setReceipt(null);
              terminalOrder.newOrder();
            }}
          />
        )}
      </div>

      {/* Only the receipt is printed, never the screen around it. */}
      {receipt && (
        <div className="hidden bg-white print:block">
          <Receipt order={receipt} terminal={terminal} cashier={cashier} />
        </div>
      )}
    </>
  );
}
