import {
  type LoyaltySettings,
  MAX_LINE_QUANTITY,
  type Order,
  type OrderLine,
  type OrderTable,
  type OrderType,
  toMils,
} from '@pos/shared';
import { useTranslation } from 'react-i18next';
import { secondaryButtonClass } from '../../components/form';
import { Price } from '../../components/Price';
import { localize } from '../../i18n/localize';

const payButtonClass =
  'w-full rounded-md bg-emerald-700 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-800 focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:outline-none disabled:opacity-60';

const stepClass =
  'h-9 w-9 rounded-md border border-slate-300 bg-white text-lg font-semibold hover:bg-slate-100 disabled:opacity-40';

function LineDetails({ line }: { line: OrderLine }) {
  const { i18n } = useTranslation();
  const names = (modifiers: OrderLine['modifiers']) =>
    modifiers.map((modifier) => localize(modifier.name, i18n.language)).join(', ');

  return (
    <>
      {line.modifiers.length > 0 && (
        <p className="text-xs text-slate-600">{names(line.modifiers)}</p>
      )}
      {line.choices.map((choice) => (
        <p key={choice.slotId} className="text-xs text-slate-600">
          {localize(choice.name, i18n.language)}
          {choice.modifiers.length > 0 && ` (${names(choice.modifiers)})`}
        </p>
      ))}
    </>
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
    <li className={`space-y-1 border-b border-slate-100 py-2 ${voided ? 'text-slate-400' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`font-medium ${voided ? 'line-through' : 'text-slate-900'}`}>{name}</p>
          <LineDetails line={line} />
          {voided && line.voidReason && (
            <p className="text-xs">{t('pos.order.voidedBecause', { reason: line.voidReason })}</p>
          )}
        </div>
        <p className={`text-sm font-medium ${voided ? 'line-through' : ''}`}>
          <Price value={line.lineTotal} />
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {line.status === 'pending' ? (
          <div className="flex items-center gap-2">
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
              {line.quantity === 1 ? '×' : '−'}
            </button>
            <span className="w-6 text-center font-semibold">{line.quantity}</span>
            <button
              type="button"
              aria-label={t('pos.order.moreOf', { name })}
              disabled={busy || line.quantity >= MAX_LINE_QUANTITY}
              onClick={() => onQuantity(line, line.quantity + 1)}
              className={stepClass}
            >
              +
            </button>
          </div>
        ) : (
          <p className="text-sm">
            {t('pos.order.quantity', { count: line.quantity })}
            <span
              className={`ms-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                voided ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-900'
              }`}
            >
              {voided
                ? t('pos.order.voided')
                : line.kitchenStatus === 'preparing'
                  ? t('pos.order.kitchen.preparing')
                  : line.kitchenStatus === 'ready'
                    ? t('pos.order.kitchen.ready')
                    : line.kitchenStatus === 'done'
                      ? t('pos.order.kitchen.done')
                      : t('pos.order.sent')}
            </span>
          </p>
        )}
        {line.status === 'sent' && canMarkDone && line.kitchenStatus === 'ready' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onMarkDone(line)}
            className="rounded-md bg-emerald-700 px-2 py-1 text-sm font-medium text-white hover:bg-emerald-800"
            aria-label={`${t('pos.order.markDone')}: ${name}`}
          >
            {t('pos.order.markDone')}
          </button>
        )}
        {line.status === 'sent' && !closed && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onVoid(line)}
            className="rounded-md px-2 py-1 text-sm font-medium text-red-700 hover:bg-red-50"
            aria-label={t('pos.order.voidLine', { name })}
          >
            {t('pos.order.void')}
          </button>
        )}
      </div>
    </li>
  );
}

// The table of a dine-in order, with the buttons to choose or change it (spec 023, rules 3 to 5).
function TableRow({ table, type, open, busy, ...props }: OrderPanelProps & { open: boolean }) {
  const { t } = useTranslation();
  if (table) {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1 text-sm"
        data-testid="order-table"
      >
        <p>
          <span className="font-medium">{t('pos.table.name', { name: table.name })}</span>{' '}
          <span className="text-xs text-slate-600">
            <bdi>{table.area}</bdi>
          </span>
        </p>
        {open && (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={props.onChooseTable}
              className="rounded-md px-2 py-1 text-xs font-medium text-slate-700 underline"
            >
              {t('pos.table.change')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={props.onRemoveTable}
              aria-label={t('pos.table.remove')}
              className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 underline"
            >
              {t('pos.promo.remove')}
            </button>
          </div>
        )}
      </div>
    );
  }
  return type === 'dine_in' && open ? (
    <button
      type="button"
      disabled={busy}
      onClick={props.onChooseTable}
      className={`${secondaryButtonClass} w-full`}
    >
      {t('pos.table.choose')}
    </button>
  ) : null;
}

interface CustomerRowProps extends OrderPanelProps {
  order: Order;
  open: boolean;
}

// Who the order is for, their points, and the buttons to change them (spec 022, rules 2 and 4).
function CustomerRow({ order, open, busy, loyalty, ...props }: CustomerRowProps) {
  const { t } = useTranslation();
  const { customer } = order;

  if (!customer) {
    return open ? (
      <button
        type="button"
        disabled={busy}
        onClick={props.onCustomer}
        className={`${secondaryButtonClass} w-full`}
      >
        {t('pos.customer.button')}
      </button>
    ) : null;
  }

  const canSpend =
    open &&
    loyalty.enabled &&
    order.pointsRedeemed === 0 &&
    customer.points >= loyalty.minRedeem &&
    toMils(order.total) > 0;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1 text-sm"
      data-testid="order-customer"
    >
      <div className="min-w-0">
        <p className="font-medium">
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
      </div>
      <div className="flex gap-2">
        {canSpend && (
          <button
            type="button"
            disabled={busy}
            onClick={props.onPoints}
            className="rounded-md bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-800"
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
            className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 underline"
          >
            {t('pos.promo.remove')}
          </button>
        )}
      </div>
    </div>
  );
}

interface OrderPanelProps {
  order: Order | null;
  type: OrderType;
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
      className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${
        type === key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }`}
    >
      {t(`pos.order.types.${key}`)}
    </button>
  );

  return (
    <section
      aria-label={t('pos.order.label')}
      className="flex min-h-0 flex-col rounded-lg border border-slate-200 bg-white"
    >
      <div className="space-y-2 border-b border-slate-200 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">
            {order ? t('pos.order.number', { number: order.number }) : t('pos.order.new')}
          </h2>
          {order?.status === 'voided' && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
              {t('pos.order.voided')}
            </span>
          )}
          {order?.status === 'open' && order.billPrintedAt && (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-950">
              {t('pos.table.billPrinted')}
            </span>
          )}
          {order?.status === 'paid' && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
              {t('pos.order.paid')}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {typeButton('dine_in')}
          {typeButton('takeaway')}
        </div>
        <TableRow {...props} open={open} />
        {order && <CustomerRow {...props} order={order} open={open} />}
      </div>

      <div className="min-h-32 flex-1 overflow-y-auto px-3">
        {lines.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">{t('pos.order.empty')}</p>
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

      <dl className="space-y-1 border-t border-slate-200 p-3 text-sm">
        <div className="flex justify-between">
          <dt>{t('pos.order.subtotal')}</dt>
          <dd>
            <Price value={order?.subtotal ?? '0.000'} />
          </dd>
        </div>
        {/* What each promotion took off, and the code typed (spec 021). */}
        {order?.promotions.map((promotion) => (
          <div key={promotion.id} className="flex justify-between text-emerald-800">
            <dt>{localize(promotion.name, i18n.language)}</dt>
            <dd>
              − <Price value={promotion.amount} />
            </dd>
          </div>
        ))}
        {order?.promoCode ? (
          <div className="flex items-center justify-between text-xs text-slate-600">
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
                  className="underline"
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
                className="text-xs text-slate-600 underline"
              >
                {t('pos.promo.add')}
              </button>
            </div>
          )
        )}
        {order?.discount && (
          <div className="flex justify-between text-red-700">
            <dt>
              {t('pos.order.discount')}
              {order.discount.kind === 'percent' && (
                <>
                  {' '}
                  <bdi dir="ltr">({Number(order.discount.value)}%)</bdi>
                </>
              )}
            </dt>
            <dd>
              − <Price value={order.discount.amount} />
            </dd>
          </div>
        )}
        {order && order.pointsRedeemed > 0 && (
          <div className="flex justify-between text-emerald-800">
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
                    className="text-xs text-slate-600 underline"
                  >
                    {t('pos.promo.remove')}
                  </button>
                </>
              )}
            </dt>
            <dd>
              − <Price value={order.pointsDiscount} />
            </dd>
          </div>
        )}
        {order && Number(order.refunded) > 0 && (
          <div className="flex justify-between text-red-700">
            <dt>{t('pos.order.refunds')}</dt>
            <dd>
              − <Price value={order.refunded} />
            </dd>
          </div>
        )}
        <div className="flex justify-between text-lg font-semibold">
          <dt>{t('pos.order.total')}</dt>
          <dd data-testid="order-total">
            <Price value={order?.total ?? '0.000'} />
          </dd>
        </div>
        {order && order.pointsEarned > 0 && (
          <div className="flex justify-between text-xs text-slate-600">
            <dt>{t('pos.points.earned')}</dt>
            <dd>{t('pos.customer.points', { count: order.pointsEarned })}</dd>
          </div>
        )}
      </dl>

      <div className="space-y-2 border-t border-slate-200 p-3">
        <button
          type="button"
          disabled={busy || !order || !open || live === 0}
          onClick={props.onPay}
          className={payButtonClass}
        >
          {t('pos.order.pay')} <Price value={order?.total ?? '0.000'} />
        </button>
        <button
          type="button"
          disabled={busy || !open || pending === 0}
          onClick={props.onSend}
          className={`${secondaryButtonClass} w-full py-3 text-base`}
        >
          {pending > 0 ? t('pos.order.sendCount', { count: pending }) : t('pos.order.send')}
        </button>
        <div className="grid grid-cols-2 gap-2">
          {order?.status === 'paid' ? (
            <button
              type="button"
              disabled={busy || toMils(order.refunded) >= toMils(order.total)}
              onClick={props.onRefund}
              className={secondaryButtonClass}
            >
              {t('pos.order.refund')}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || !open || live === 0}
              onClick={props.onDiscount}
              className={secondaryButtonClass}
            >
              {t('pos.order.discountButton')}
            </button>
          )}
          {open && (
            <button
              type="button"
              disabled={busy || !order || live === 0}
              onClick={props.onPrintBill}
              className={secondaryButtonClass}
            >
              {t('pos.table.printBill')}
            </button>
          )}
          <button
            type="button"
            disabled={busy || !order || !open}
            onClick={props.onVoidOrder}
            className={secondaryButtonClass}
          >
            {t('pos.order.voidOrder')}
          </button>
          <button
            type="button"
            disabled={busy || !order}
            onClick={props.onNewOrder}
            className={secondaryButtonClass}
          >
            {t('pos.order.newOrder')}
          </button>
        </div>
      </div>
    </section>
  );
}
