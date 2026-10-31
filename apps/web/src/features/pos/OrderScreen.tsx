import {
  defaultBrandSettings,
  type Order,
  type OrderLine,
  type OrderType,
  printsKitchenSlip,
  type ShiftSummary,
} from '@pos/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Armchair, ReceiptText } from 'lucide-react';
import { BrandMark } from '../../components/BrandMark';
import { secondaryButtonClass } from '../../components/form';
import { useBrandColor } from '../../lib/use-brand-color';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import { localize } from '../../i18n/localize';
import { useAuth } from '../auth/auth-context';
import { getBranchMenu, menuKeys } from '../menu/menu-api';
import { useNow } from '../menu/use-now';
import { AccountMenu } from './AccountMenu';
import { ApprovalDialog } from './ApprovalDialog';
import { type Choosing, ChoiceDialog } from './ChoiceDialog';
import { CustomerDialog } from './CustomerDialog';
import { DeliveryDialog } from './DeliveryDialog';
import { DiscountDialog } from './DiscountDialog';
import { FloorDialog } from './FloorDialog';
import { KitchenSlip } from './KitchenSlip';
import { PromoCodeDialog } from './PromoCodeDialog';
import { MenuPanel } from './MenuPanel';
import { OpenOrdersDialog } from './OpenOrdersDialog';
import { OrderPanel } from './OrderPanel';
import { PaymentDialog } from './PaymentDialog';
import { PointsDialog } from './PointsDialog';
import { kitchenSlipDocument, receiptDocument } from './print-document';
import { PrintStatus } from './PrintStatus';
import { BillDialog, Receipt, ReceiptDialog } from './Receipt';
import { RefundDialog } from './RefundDialog';
import { usePrinting } from './use-printing';
import { useBrandSettings } from '../settings/settings-api';

// How often a terminal asks for the brand's settings again (spec 009, rule 8).
export const SETTINGS_REFRESH_MS = 180_000;
import type { Terminal } from './terminal-store';
import { useTerminalOrder } from './use-terminal-order';
import { VoidDialog } from './VoidDialog';

type Voiding = { kind: 'line'; line: OrderLine } | { kind: 'order' };

const headerButtonClass = secondaryButtonClass;
// Until the menu of the branch has loaded.
const defaultOffered: readonly OrderType[] = ['dine_in', 'takeaway'];

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
  const { user } = useAuth();
  const now = useNow();
  const menu = useQuery({
    queryKey: menuKeys.branchMenu(terminal.branchId),
    queryFn: () => getBranchMenu(terminal.branchId),
  });

  // The order types the branch offers: a kiosk has no Dine-in, a branch with drivers has Delivery
  // (docs/specs/026-order-types.md).
  const offered = menu.data?.orderTypes ?? defaultOffered;
  const terminalOrder = useTerminalOrder(terminal.branchId, terminal.brandId, offered);
  // The brand's settings: ways to pay, discount buttons, who marks dishes done (spec 009).
  const settings = useBrandSettings(terminal.brandId, SETTINGS_REFRESH_MS);
  const brandSettings = settings.data ?? defaultBrandSettings;
  const { order, busy, notice } = terminalOrder;

  const [choosing, setChoosing] = useState<Choosing | null>(null);
  const [voiding, setVoiding] = useState<Voiding | null>(null);
  const [discounting, setDiscounting] = useState(false);
  const [promoCoding, setPromoCoding] = useState(false);
  const [customering, setCustomering] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [pointing, setPointing] = useState(false);
  // The floor of the branch: to open a table's order, or to move the order on the screen.
  const [floorMode, setFloorMode] = useState<'open' | 'move' | null>(null);
  // The order whose bill is shown, and printed (spec 023).
  const [bill, setBill] = useState<Order | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [listing, setListing] = useState(false);
  const [paying, setPaying] = useState(false);
  // The paid order whose receipt is shown, and printed.
  const [receipt, setReceipt] = useState<Order | null>(null);

  // Printing: on the branch's printers through the bridge, or through the browser
  // (docs/specs/028-print-bridge.md).
  const printing = usePrinting(menu.data, terminal.branchId);
  const words = { t, language: i18n.language };

  // The kitchen slip of the dishes just sent, printed by itself when the branch wants one
  // (docs/specs/027-kitchen-screen-and-slip.md, rule 4). What follows it, the receipt after a
  // payment, waits until it has gone to the printer.
  const [slip, setSlip] = useState<{ order: Order; lineIds: string[] } | null>(null);
  // The last slip, to print it from this device when the printer did not.
  const [lastSlip, setLastSlip] = useState<{ order: Order; lineIds: string[] } | null>(null);
  const printSlipHere = (order: Order, lineIds: string[]) => {
    // The slip must be on the page before the browser prints it.
    flushSync(() => setSlip({ order, lineIds }));
    window.print();
    setSlip(null);
  };
  const printSlip = (order: Order, lineIds: string[]) => {
    setLastSlip({ order, lineIds });
    void printing.print(
      'kitchen',
      kitchenSlipDocument(order, lineIds, terminal, words),
      order.number,
      () => printSlipHere(order, lineIds),
    );
  };
  const printsSlip = menu.data ? printsKitchenSlip(menu.data.kitchen) : false;
  const slipPrint = printing.stateOf('kitchen');
  // How many of each dish the order already has, for the badge on its tile.
  const inOrder = new Map<string, number>();
  for (const line of order?.lines ?? []) {
    const id = line.itemId ?? line.comboId;
    if (id && line.status !== 'voided') inOrder.set(id, (inOrder.get(id) ?? 0) + line.quantity);
  }
  useBrandColor(menu.data?.brand.color);
  const brandName = terminal.brandName
    ? localize(terminal.brandName, i18n.language)
    : t('app.name');
  const unsent = () =>
    (terminalOrder.order?.lines ?? [])
      .filter((line) => line.status === 'pending')
      .map((line) => line.id);
  // A delivery order is sent and paid with its phone and address (spec 026, rule 5): the box
  // opens first when they are missing.
  const needsDelivery = terminalOrder.type === 'delivery' && !terminalOrder.delivery;

  const send = () => {
    if (needsDelivery) {
      setDelivering(true);
      return;
    }
    const lineIds = unsent();
    void terminalOrder.send().then((sent) => {
      if (sent && printsSlip && lineIds.length > 0) printSlip(sent, lineIds);
    });
  };

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
      <div className="flex min-h-screen flex-col bg-canvas text-ink print:hidden lg:h-screen">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-white px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark name={brandName} logoUrl={menu.data?.brand.logoUrl} />
            <div className="min-w-0">
              <p className="leading-tight font-semibold">{brandName}</p>
              <p className="truncate text-sm text-slate-600">
                {localize(terminal.branchName, i18n.language)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="num px-2 text-lg font-semibold" dir="ltr">
              {clock}
            </span>
            {/* A branch without Dine-in has no tables to show (spec 026, rule 3). */}
            {offered.includes('dine_in') && (
              <button
                type="button"
                onClick={() => setFloorMode('open')}
                className={headerButtonClass}
              >
                <Armchair aria-hidden="true" />
                {t('pos.table.button')}
              </button>
            )}
            <button type="button" onClick={() => setListing(true)} className={headerButtonClass}>
              <ReceiptText aria-hidden="true" />
              {t('pos.openOrders.button')}
            </button>
            <LanguageSwitcher />
            <AccountMenu
              shiftSince={t('pos.shift.since', { time: timeOf(shift.openedAt) })}
              onCloseShift={onCloseShift}
            />
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

        {slipPrint.status === 'failed' && lastSlip && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-red-50 px-4 py-2 text-sm text-red-800">
            <span className="font-semibold">{t('pos.printing.slipFailed')}</span>
            <div className="min-w-0 flex-1">
              <PrintStatus
                state={slipPrint}
                onPrintHere={() => {
                  printing.reset('kitchen');
                  printSlipHere(lastSlip.order, lastSlip.lineIds);
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => printing.reset('kitchen')}
              aria-label={t('pos.notices.dismiss')}
              className="rounded px-2 font-semibold"
            >
              ×
            </button>
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_26rem]">
          <div className="min-h-0 overflow-y-auto p-4">
            {menu.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
            {menu.isError && (
              <p role="alert" className="text-sm text-red-700">
                {t('common.loadError')}
              </p>
            )}
            {menu.data && (
              <MenuPanel
                menu={menu.data}
                now={now}
                disabled={busy}
                onPick={pick}
                inOrder={inOrder}
              />
            )}
          </div>

          <OrderPanel
            order={order}
            type={terminalOrder.type}
            offered={offered}
            delivery={terminalOrder.delivery}
            onDelivery={() => setDelivering(true)}
            busy={busy}
            onType={terminalOrder.setType}
            onQuantity={terminalOrder.setQuantity}
            onVoidLine={(line) => setVoiding({ kind: 'line', line })}
            onSend={send}
            onDiscount={() => setDiscounting(true)}
            onPromoCode={() => setPromoCoding(true)}
            onRemovePromoCode={() => terminalOrder.removePromoCode()}
            loyalty={brandSettings.loyalty}
            onCustomer={() => setCustomering(true)}
            onRemoveCustomer={terminalOrder.removeCustomer}
            onPoints={() => setPointing(true)}
            onRemovePoints={terminalOrder.removePoints}
            table={terminalOrder.table}
            onChooseTable={() => setFloorMode('move')}
            onRemoveTable={terminalOrder.removeTable}
            onPrintBill={() => {
              void terminalOrder.printBill().then((billed) => {
                if (billed) setBill(billed);
              });
            }}
            onRefund={() => setRefunding(true)}
            onVoidOrder={() => setVoiding({ kind: 'order' })}
            onNewOrder={terminalOrder.newOrder}
            onPay={() => (needsDelivery ? setDelivering(true) : setPaying(true))}
            canMarkDone={brandSettings.ticketDoneBy === 'cashier'}
            onMarkDone={terminalOrder.markDone}
          />
        </div>

        {delivering && (
          <DeliveryDialog
            current={terminalOrder.delivery}
            onApply={terminalOrder.applyDelivery}
            onCancel={() => setDelivering(false)}
          />
        )}

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

        {promoCoding && order && (
          <PromoCodeDialog
            onApply={terminalOrder.applyPromoCode}
            onCancel={() => setPromoCoding(false)}
          />
        )}

        {floorMode && (
          <FloorDialog
            branchId={terminal.branchId}
            mode={floorMode}
            currentTableId={floorMode === 'move' ? (terminalOrder.table?.id ?? null) : null}
            onClose={() => setFloorMode(null)}
            onTaken={(id) => {
              setFloorMode(null);
              terminalOrder.open(id);
            }}
            onFree={(table) => {
              const mode = floorMode;
              setFloorMode(null);
              if (mode === 'move') terminalOrder.chooseTable(table);
              else terminalOrder.startAt(table);
            }}
          />
        )}

        {bill && (
          <BillDialog
            order={bill}
            terminal={terminal}
            cashier={cashier}
            onClose={() => {
              setBill(null);
              printing.reset('bill');
            }}
            onPrint={() =>
              void printing.print(
                'bill',
                receiptDocument(bill, terminal, cashier, true, words),
                bill.number,
                () => window.print(),
              )
            }
            printState={printing.stateOf('bill')}
            onPrintHere={() => window.print()}
          />
        )}

        {customering && order && (
          <CustomerDialog
            onApply={terminalOrder.applyCustomer}
            onCancel={() => setCustomering(false)}
          />
        )}

        {pointing && order && (
          <PointsDialog
            order={order}
            loyalty={brandSettings.loyalty}
            onApply={terminalOrder.applyPoints}
            onCancel={() => setPointing(false)}
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
              // Paying sends what was not sent yet, so its slip prints first.
              const lineIds = unsent();
              void terminalOrder.pay(tenders).then((paid) => {
                if (!paid) return;
                if (printsSlip && lineIds.length > 0) printSlip(paid, lineIds);
                setReceipt(paid);
              });
            }}
          />
        )}

        {receipt && (
          <ReceiptDialog
            order={receipt}
            terminal={terminal}
            cashier={cashier}
            onClose={() => {
              setReceipt(null);
              printing.reset('receipt');
            }}
            onNewOrder={() => {
              setReceipt(null);
              printing.reset('receipt');
              terminalOrder.newOrder();
            }}
            onPrint={() =>
              void printing.print(
                'receipt',
                receiptDocument(receipt, terminal, cashier, false, words),
                receipt.number,
                () => window.print(),
              )
            }
            printState={printing.stateOf('receipt')}
            onPrintHere={() => window.print()}
          />
        )}
      </div>

      {/* Only the slip or the receipt is printed, never the screen around it. */}
      {slip && (
        <div className="hidden bg-white print:block">
          <KitchenSlip order={slip.order} lineIds={slip.lineIds} terminal={terminal} />
        </div>
      )}
      {bill && !receipt && !slip && (
        <div className="hidden bg-white print:block">
          <Receipt order={bill} terminal={terminal} cashier={cashier} bill />
        </div>
      )}
      {receipt && !slip && (
        <div className="hidden bg-white print:block">
          <Receipt order={receipt} terminal={terminal} cashier={cashier} />
        </div>
      )}
    </>
  );
}
