import {
  type DeliveryDetails,
  type LoyaltySettings,
  MAX_LINE_QUANTITY,
  type Order,
  type OrderLine,
  type OrderTable,
  type OrderType,
  toMils,
} from '@pos/shared';
import {
  Armchair,
  Ban,
  BellRing,
  Check,
  ChefHat,
  Minus,
  Percent,
  Plus,
  Printer,
  RotateCcw,
  Send,
  ShoppingBag,
  SquarePlus,
  Trash2,
  Truck,
  UserRound,
  UtensilsCrossed,
} from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { chipClass } from '../../components/form';
import { Price } from '../../components/Price';
import { localize } from '../../i18n/localize';

// One loud action: Pay, in the money colour, with the total in large figures (docs/specs and the
// redesign, principle 1). Send to kitchen is the clear second; the rest is a row of icon buttons.
const payButtonClass =
  'flex min-h-16 flex-col items-center justify-center rounded-xl bg-money px-4 text-white shadow-[0_6px_16px_rgb(14_122_85/0.28)] hover:bg-money-strong focus-visible:ring-2 focus-visible:ring-money/40 focus-visible:ring-offset-2 focus-visible:outline-none disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none';

const sendButtonClass =
  'flex min-h-16 items-center justify-center gap-2 rounded-xl border-[1.5px] border-ink bg-white px-3 text-center text-sm leading-tight font-bold text-ink hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none disabled:border-slate-200 disabled:text-slate-400 [&_svg]:size-5 [&_svg]:shrink-0';

const toolClass =
  'flex min-h-14 flex-col items-center justify-center gap-1 rounded-control border border-line bg-white px-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-ink/25 focus-visible:outline-none disabled:opacity-40 [&_svg]:size-5';

const stepClass =
  'grid size-10 place-items-center text-slate-700 hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none disabled:opacity-40 [&_svg]:size-4';

const linkButtonClass =
  'rounded px-1 text-xs font-medium text-slate-600 underline underline-offset-2 hover:text-ink disabled:opacity-50';

function LineDetails({ line }: { line: OrderLine }) {
  const { i18n } = useTranslation();
  const names = (modifiers: OrderLine['modifiers']) =>
    modifiers.map((modifier) => localize(modifier.name, i18n.language)).join(', ');

  return (
    <>
      {line.modifiers.length > 0 && (
        <p className="text-[13px] text-slate-600">{names(line.modifiers)}</p>
      )}
      {line.choices.map((choice) => (
        <p key={choice.slotId} className="text-[13px] text-slate-600">
          {localize(choice.name, i18n.language)}
          {choice.modifiers.length > 0 && ` (${names(choice.modifiers)})`}
        </p>
      ))}
    </>
  );
}

// Where a sent dish is in the kitchen, as a pill with an icon.
function KitchenChip({ line }: { line: OrderLine }) {
  const { t } = useTranslation();
  if (line.status === 'voided') {
    return (
      <span className={`${chipClass} bg-slate-100 text-slate-500`}>{t('pos.order.voided')}</span>
    );
  }
  if (line.kitchenStatus === 'ready') {
    return (
      <span className={`${chipClass} bg-money-soft text-money`}>
        <BellRing aria-hidden="true" />
        {t('pos.order.kitchen.ready')}
      </span>
    );
  }
  if (line.kitchenStatus === 'done') {
    return (
      <span className={`${chipClass} bg-slate-100 text-slate-600`}>
        <Check aria-hidden="true" />
        {t('pos.order.kitchen.done')}
      </span>
    );
  }
  return (
    <span className={`${chipClass} bg-warn-soft text-warn`}>
      <ChefHat aria-hidden="true" />
      {line.kitchenStatus === 'preparing' ? t('pos.order.kitchen.preparing') : t('pos.order.sent')}
    </span>
  );
}

interface LineRowProps {
  line: OrderLine;
  busy: boolean;
  // The order is paid or voided: its lines can only be looked at.
  closed: boolean;
  // The cashier marks ready dishes done when the food is handed over (spec 009, rule 7).
  canMarkDone: boolean;
  onQuantity: (line: OrderLine, quantity: number) => void;
  onVoid: (line: OrderLine) => void;
  onMarkDone: (line: OrderLine) => void;
}

function LineRow({
  line,
  busy,
  closed,
  canMarkDone,
  onQuantity,
  onVoid,
  onMarkDone,
}: LineRowProps) {
  const { t, i18n } = useTranslation();
  const name = localize(line.name, i18n.language);
  const voided = line.status === 'voided';

  return (
    <li
      className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 border-b border-dashed border-line py-3 ${
        voided ? 'text-slate-400' : ''
      }`}
    >
      {line.status === 'pending' ? (
        <div className="flex items-center overflow-hidden rounded-control border border-slate-300 bg-white">
          <button
            type="button"
            aria-label={
              line.quantity === 1
                ? t('pos.order.removeLine', { name })
                : t('pos.order.lessOf', { name })
            }
            disabled={busy}
            onClick={() => onQuantity(line, line.quantity - 1)}
            className={stepClass}
          >
            {line.quantity === 1 ? <Trash2 aria-hidden="true" /> : <Minus aria-hidden="true" />}
          </button>
          <span className="num w-7 text-center text-base font-bold">{line.quantity}</span>
          <button
            type="button"
            aria-label={t('pos.order.moreOf', { name })}
            disabled={busy || line.quantity >= MAX_LINE_QUANTITY}
            onClick={() => onQuantity(line, line.quantity + 1)}
            className={stepClass}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
      ) : (
        <span
          className={`num grid h-10 min-w-10 place-items-center rounded-control px-2 text-base font-bold ${
            voided ? 'bg-slate-50' : 'bg-slate-100'
          }`}
          aria-label={t('pos.order.quantity', { count: line.quantity })}
        >
          {line.quantity}×
        </span>
      )}

      <div className="min-w-0 space-y-1">
        <p className={`leading-snug font-semibold ${voided ? 'line-through' : 'text-ink'}`}>
          {name}
        </p>
        <LineDetails line={line} />
        {voided && line.voidReason && (
          <p className="text-xs">{t('pos.order.voidedBecause', { reason: line.voidReason })}</p>
        )}
        {line.status !== 'pending' && (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <KitchenChip line={line} />
            {line.status === 'sent' && canMarkDone && line.kitchenStatus === 'ready' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onMarkDone(line)}
                className={`${chipClass} bg-money py-1 text-white hover:bg-money-strong`}
                aria-label={`${t('pos.order.markDone')}: ${name}`}
              >
                <Check aria-hidden="true" />
                {t('pos.order.markDone')}
              </button>
            )}
            {line.status === 'sent' && !closed && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onVoid(line)}
                className={`${chipClass} py-1 text-danger hover:bg-danger-soft`}
                aria-label={t('pos.order.voidLine', { name })}
              >
                <Ban aria-hidden="true" />
                {t('pos.order.void')}
              </button>
            )}
          </div>
        )}
      </div>

      <p className={`num pt-2 text-base font-bold ${voided ? 'line-through' : ''}`}>
        <Price value={line.lineTotal} />
      </p>
    </li>
  );
}

// A row under the order type that says who or where the order is for.
function InfoRow({
  icon,
  children,
  actions,
  testId,
}: {
  icon: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  testId: string;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-slate-50 px-3 py-2 text-sm"
      data-testid={testId}
    >
      <div className="flex min-w-0 items-center gap-2.5 [&>svg]:size-[18px] [&>svg]:shrink-0 [&>svg]:text-slate-500">
        {icon}
        <div className="min-w-0">{children}</div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// The table of a dine-in order, with the buttons to choose or change it (spec 023, rules 3 to 5).
function TableRow({ table, type, open, busy, ...props }: OrderPanelProps & { open: boolean }) {
  const { t } = useTranslation();
  if (table) {
    return (
      <InfoRow
        testId="order-table"
        icon={<Armchair aria-hidden="true" />}
        actions={
          open && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={props.onChooseTable}
                className={linkButtonClass}
              >
                {t('pos.table.change')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={props.onRemoveTable}
                aria-label={t('pos.table.remove')}
                className={linkButtonClass}
              >
                {t('pos.promo.remove')}
              </button>
            </>
          )
        }
      >
        <p>
          <span className="font-semibold">{t('pos.table.name', { name: table.name })}</span>{' '}
          <span className="text-xs text-slate-600">
            <bdi>{table.area}</bdi>
          </span>
        </p>
      </InfoRow>
    );
  }
  return type === 'dine_in' && open ? (
    <button
      type="button"
      disabled={busy}
      onClick={props.onChooseTable}
      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-dashed border-slate-400 bg-white text-sm font-semibold text-ink hover:bg-slate-50 [&_svg]:size-[18px]"
    >
      <Armchair aria-hidden="true" />
      {t('pos.table.choose')}
    </button>
  ) : null;
}

// The phone and address of a delivery order, with the button to type or change them
// (docs/specs/026-order-types.md, rule 5).
function DeliveryRow({
  delivery,
  type,
  open,
  busy,
  onDelivery,
}: OrderPanelProps & { open: boolean }) {
  const { t } = useTranslation();
  if (type !== 'delivery') return null;
  if (!delivery) {
    return open ? (
      <button
        type="button"
        disabled={busy}
        onClick={onDelivery}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-dashed border-slate-400 bg-white text-sm font-semibold text-ink hover:bg-slate-50 [&_svg]:size-[18px]"
      >
        <Truck aria-hidden="true" />
        {t('pos.delivery.add')}
      </button>
    ) : null;
  }
  return (
    <InfoRow
      testId="order-delivery"
      icon={<Truck aria-hidden="true" />}
      actions={
        open && (
          <button type="button" disabled={busy} onClick={onDelivery} className={linkButtonClass}>
            {t('pos.delivery.change')}
          </button>
        )
      }
    >
      <p className="font-semibold">
        {delivery.name ? <bdi>{delivery.name}</bdi> : <bdi dir="ltr">{delivery.phone}</bdi>}
      </p>
      <p className="text-xs text-slate-600">
        {delivery.name && (
          <>
            <bdi dir="ltr">{delivery.phone}</bdi> ·{' '}
          </>
        )}
        <bdi>{delivery.address}</bdi>
      </p>
      {delivery.note && (
        <p className="text-xs text-slate-600">
          <bdi>{delivery.note}</bdi>
        </p>
      )}
    </InfoRow>
  );
}

interface CustomerRowProps extends OrderPanelProps {
  order: Order;
  open: boolean;
}

// Who the order is for, their points, and the buttons to change them (spec 022, rules 2 and 4).
function CustomerRow({ order, open, busy, loyalty, ...props }: CustomerRowProps) {
  const { t } = useTranslation();
  const { customer } = order;
  if (!customer) return null;

  const canSpend =
    open &&
    loyalty.enabled &&
    order.pointsRedeemed === 0 &&
    customer.points >= loyalty.minRedeem &&
    toMils(order.total) > 0;

  return (
    <InfoRow
      testId="order-customer"
      icon={<UserRound aria-hidden="true" />}
      actions={
        <>
          {canSpend && (
            <button
              type="button"
              disabled={busy}
              onClick={props.onPoints}
              className={`${chipClass} bg-money py-1 text-white hover:bg-money-strong`}
            >
              {t('pos.points.use')}
            </button>
          )}
          {open && (
            <button
              type="button"
              disabled={busy}
              onClick={props.onRemoveCustomer}
              aria-label={t('pos.customer.remove')}
              className={linkButtonClass}
            >
              {t('pos.promo.remove')}
            </button>
          )}
        </>
      }
    >
      <p className="font-semibold">
        {customer.name ? <bdi>{customer.name}</bdi> : <bdi dir="ltr">{customer.phone}</bdi>}
      </p>
      <p className="text-xs text-slate-600">
        {customer.name && (
          <>
            <bdi dir="ltr">{customer.phone}</bdi> ·{' '}
          </>
        )}
        {t('pos.customer.points', { count: customer.points })}
      </p>
    </InfoRow>
  );
}

interface OrderPanelProps {
  order: Order | null;
  type: OrderType;
  // The order types the branch offers, in the order of its buttons (spec 026).
  offered: readonly OrderType[];
  // The phone and address of a delivery order, and the button to type them.
  delivery: DeliveryDetails | null;
  onDelivery: () => void;
  busy: boolean;
  onType: (type: OrderType) => void;
  onQuantity: (line: OrderLine, quantity: number) => void;
  onVoidLine: (line: OrderLine) => void;
  onSend: () => void;
  onDiscount: () => void;
  onPromoCode: () => void;
  onRemovePromoCode: () => void;
  // The customer on the order and the points they spend (spec 022).
  loyalty: LoyaltySettings;
  onCustomer: () => void;
  onRemoveCustomer: () => void;
  onPoints: () => void;
  onRemovePoints: () => void;
  // The table of a dine-in order, or the one picked before it exists (spec 023).
  table: OrderTable | null;
  onChooseTable: () => void;
  onRemoveTable: () => void;
  onPrintBill: () => void;
  onVoidOrder: () => void;
  onNewOrder: () => void;
  onPay: () => void;
  canMarkDone: boolean;
  onMarkDone: (line: OrderLine) => void;
  // Money back for a paid order (spec 011).
  onRefund: () => void;
}

const typeIcons: Record<OrderType, ReactNode> = {
  dine_in: <UtensilsCrossed aria-hidden="true" />,
  takeaway: <ShoppingBag aria-hidden="true" />,
  delivery: <Truck aria-hidden="true" />,
};

// The order on the screen: its type, its lines, the totals, and what can be done with it.
// See docs/specs/006-pos-terminal.md, rules 6 to 8.
export function OrderPanel(props: OrderPanelProps) {
  const { order, type, busy } = props;
  const { t, i18n } = useTranslation();
  const open = !order || order.status === 'open';
  const lines = order?.lines ?? [];
  const pending = lines.filter((line) => line.status === 'pending').length;
  const live = lines.filter((line) => line.status !== 'voided').length;

  const typeButton = (key: OrderType) => (
    <button
      type="button"
      aria-pressed={type === key}
      disabled={busy || !open}
      onClick={() => props.onType(key)}
      className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed [&_svg]:size-[18px] ${
        type === key
          ? 'bg-white text-ink shadow-[0_1px_3px_rgb(21_23_28/0.14)]'
          : 'text-slate-600 hover:text-ink'
      }`}
    >
      {typeIcons[key]}
      {t(`pos.order.types.${key}`)}
    </button>
  );

  return (
    <section
      aria-label={t('pos.order.label')}
      className="flex min-h-0 flex-col border-line bg-white lg:border-s"
    >
      <div className="space-y-3 border-b border-line px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold">
              {order ? t('pos.order.number', { number: order.number }) : t('pos.order.new')}
            </h2>
            {order?.status === 'voided' && (
              <span className={`${chipClass} bg-danger-soft text-danger`}>
                <Ban aria-hidden="true" />
                {t('pos.order.voided')}
              </span>
            )}
            {order?.status === 'open' && order.billPrintedAt && (
              <span className={`${chipClass} bg-info-soft text-info`}>
                <Printer aria-hidden="true" />
                {t('pos.table.billPrinted')}
              </span>
            )}
            {order?.status === 'paid' && (
              <span className={`${chipClass} bg-money-soft text-money`}>
                <Check aria-hidden="true" />
                {t('pos.order.paid')}
              </span>
            )}
          </div>
          <button
            type="button"
            disabled={busy || !order}
            onClick={props.onNewOrder}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-control px-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 [&_svg]:size-[18px]"
          >
            <SquarePlus aria-hidden="true" />
            {t('pos.order.newOrder')}
          </button>
        </div>
        {/* Only the types the branch offers; a branch with one type has nothing to choose. */}
        {props.offered.length > 1 && (
          <div className="flex gap-1 rounded-[0.625rem] bg-slate-100 p-1">
            {props.offered.map((key) => (
              <Fragment key={key}>{typeButton(key)}</Fragment>
            ))}
          </div>
        )}
        <TableRow {...props} open={open} />
        <DeliveryRow {...props} open={open} />
        {order && <CustomerRow {...props} order={order} open={open} />}
      </div>

      <div className="min-h-32 flex-1 overflow-y-auto px-4">
        {lines.length === 0 ? (
          <div className="flex h-full min-h-32 flex-col items-center justify-center gap-3 py-8 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-slate-100 text-slate-500">
              <ShoppingBag aria-hidden="true" className="size-6" />
            </span>
            <p className="text-sm text-slate-500">{t('pos.order.empty')}</p>
          </div>
        ) : (
          <ul>
            {lines.map((line) => (
              <LineRow
                key={line.id}
                line={line}
                busy={busy || !open}
                closed={!open}
                canMarkDone={props.canMarkDone}
                onQuantity={props.onQuantity}
                onVoid={props.onVoidLine}
                onMarkDone={props.onMarkDone}
              />
            ))}
          </ul>
        )}
      </div>

      <dl className="space-y-1 border-t border-line px-4 py-3 text-sm text-slate-600">
        <div className="flex justify-between">
          <dt>{t('pos.order.subtotal')}</dt>
          <dd className="num">
            <Price value={order?.subtotal ?? '0.000'} />
          </dd>
        </div>
        {/* What each promotion took off, and the code typed (spec 021). */}
        {order?.promotions.map((promotion) => (
          <div key={promotion.id} className="flex justify-between text-money">
            <dt>{localize(promotion.name, i18n.language)}</dt>
            <dd className="num">
              − <Price value={promotion.amount} />
            </dd>
          </div>
        ))}
        {order?.promoCode ? (
          <div className="flex items-center justify-between text-xs">
            <dt>
              {t('pos.promo.typed')} <bdi dir="ltr">{order.promoCode}</bdi>
            </dt>
            <dd>
              {open && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={props.onRemovePromoCode}
                  aria-label={t('pos.promo.removeFor', { code: order.promoCode })}
                  className={linkButtonClass}
                >
                  {t('pos.promo.remove')}
                </button>
              )}
            </dd>
          </div>
        ) : (
          open &&
          live > 0 && (
            <div className="flex justify-end">
              <button
                type="button"
                disabled={busy}
                onClick={props.onPromoCode}
                className={linkButtonClass}
              >
                {t('pos.promo.add')}
              </button>
            </div>
          )
        )}
        {order?.discount && (
          <div className="flex justify-between text-money">
            <dt>
              {t('pos.order.discount')}
              {order.discount.kind === 'percent' && (
                <>
                  {' '}
                  <bdi dir="ltr">({Number(order.discount.value)}%)</bdi>
                </>
              )}
            </dt>
            <dd className="num">
              − <Price value={order.discount.amount} />
            </dd>
          </div>
        )}
        {order && order.pointsRedeemed > 0 && (
          <div className="flex justify-between text-money">
            <dt>
              {t('pos.points.row', { count: order.pointsRedeemed })}
              {open && (
                <>
                  {' '}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={props.onRemovePoints}
                    aria-label={t('pos.points.remove')}
                    className={linkButtonClass}
                  >
                    {t('pos.promo.remove')}
                  </button>
                </>
              )}
            </dt>
            <dd className="num">
              − <Price value={order.pointsDiscount} />
            </dd>
          </div>
        )}
        {order && Number(order.refunded) > 0 && (
          <div className="flex justify-between text-danger">
            <dt>{t('pos.order.refunds')}</dt>
            <dd className="num">
              − <Price value={order.refunded} />
            </dd>
          </div>
        )}
        <div className="flex items-baseline justify-between pt-1 text-ink">
          <dt className="text-lg font-bold">{t('pos.order.total')}</dt>
          <dd data-testid="order-total" className="num text-[1.75rem] leading-none font-bold">
            <Price value={order?.total ?? '0.000'} />
          </dd>
        </div>
        {order && order.pointsEarned > 0 && (
          <div className="flex justify-between text-xs">
            <dt>{t('pos.points.earned')}</dt>
            <dd>{t('pos.customer.points', { count: order.pointsEarned })}</dd>
          </div>
        )}
      </dl>

      <div className="space-y-2 border-t border-line px-4 pt-3 pb-4">
        <div className="grid grid-cols-4 gap-2">
          {order && open && !order.customer ? (
            <button type="button" disabled={busy} onClick={props.onCustomer} className={toolClass}>
              <UserRound aria-hidden="true" />
              {t('pos.customer.button')}
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
          {order?.status === 'paid' ? (
            <button
              type="button"
              disabled={busy || toMils(order.refunded) >= toMils(order.total)}
              onClick={props.onRefund}
              className={toolClass}
            >
              <RotateCcw aria-hidden="true" />
              {t('pos.order.refund')}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || !open || live === 0}
              onClick={props.onDiscount}
              className={toolClass}
            >
              <Percent aria-hidden="true" />
              {t('pos.order.discountButton')}
            </button>
          )}
          {open ? (
            <button
              type="button"
              disabled={busy || !order || live === 0}
              onClick={props.onPrintBill}
              className={toolClass}
            >
              <Printer aria-hidden="true" />
              {t('pos.table.printBill')}
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
          <button
            type="button"
            disabled={busy || !order || !open}
            onClick={props.onVoidOrder}
            className={`${toolClass} text-danger`}
          >
            <Ban aria-hidden="true" />
            {t('pos.order.voidOrder')}
          </button>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-2">
          <button
            type="button"
            disabled={busy || !open || pending === 0}
            onClick={props.onSend}
            className={sendButtonClass}
          >
            <Send aria-hidden="true" />
            {pending > 0 ? t('pos.order.sendCount', { count: pending }) : t('pos.order.send')}
          </button>
          <button
            type="button"
            disabled={busy || !order || !open || live === 0}
            onClick={props.onPay}
            className={payButtonClass}
          >
            <span className="text-sm font-semibold opacity-90">{t('pos.order.pay')}</span>{' '}
            <span className="num text-[1.4rem] leading-tight font-bold">
              <Price value={order?.total ?? '0.000'} />
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}
