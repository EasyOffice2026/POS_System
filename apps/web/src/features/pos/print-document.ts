import type { Order } from '@pos/shared';
import type { TFunction } from 'i18next';
import { formatDateTime } from '../../i18n/format';
import { localize } from '../../i18n/localize';
import type { Terminal } from './terminal-store';

// What is printed, as lines: the receipt and the kitchen slip are built once here, and drawn
// twice, on the screen (PrintDocumentView) and as the picture the printer gets (print-image).
// So what the cashier sees is what comes out of the printer, in Arabic as in English.

export type PrintSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

// A piece written left to right whatever the language: a price, a phone number.
export interface LtrText {
  ltr: string;
}
export type PrintText = string | (string | LtrText)[];

export type PrintLine =
  | {
      kind: 'text';
      text: PrintText;
      align?: 'center' | 'start';
      size?: PrintSize;
      bold?: boolean;
      muted?: boolean;
      italic?: boolean;
      upper?: boolean;
      // Under the line it belongs to: a choice, an extra, a note.
      indent?: boolean;
    }
  | {
      kind: 'row';
      start: PrintText;
      end: PrintText;
      size?: PrintSize;
      bold?: boolean;
      muted?: boolean;
    }
  | { kind: 'rule' }
  | { kind: 'gap' };

export interface PrintDocument {
  kind: 'receipt' | 'kitchen-slip';
  lines: PrintLine[];
}

export const plainText = (text: PrintText): string =>
  typeof text === 'string'
    ? text
    : text.map((piece) => (typeof piece === 'string' ? piece : piece.ltr)).join('');

interface Words {
  t: TFunction;
  language: string;
}

// A price as the API sends it, followed by the currency; the figures never change places.
const money = (value: string, { t }: Words, sign = ''): PrintText => [
  sign,
  { ltr: value },
  ` ${t('menu.currency')}`,
];

// What was sold and how it was paid. It shows no tax until the VAT decision is made, and nothing
// it cannot back up (docs/specs/007-payments.md, rule 9). A bill is the same before payment, for
// the table (docs/specs/023-floor-plan.md).
export function receiptDocument(
  order: Order,
  terminal: Terminal,
  cashier: string,
  bill: boolean,
  words: Words,
): PrintDocument {
  const { t, language } = words;
  const name = (text: Parameters<typeof localize>[0]) => localize(text, language);
  const names = (modifiers: Order['lines'][number]['modifiers']) =>
    modifiers.map((modifier) => name(modifier.name)).join(', ');
  const lines: PrintLine[] = [];
  const small = { kind: 'text', align: 'center', size: 'xs', muted: true } as const;

  if (terminal.brandName) {
    lines.push({ kind: 'text', text: name(terminal.brandName), align: 'center', bold: true });
  }
  lines.push({ kind: 'text', text: name(terminal.branchName), align: 'center' });
  lines.push({
    kind: 'text',
    text: t('pos.order.number', { number: order.number }),
    align: 'center',
    size: 'lg',
    bold: true,
  });
  const when = bill ? (order.billPrintedAt ?? order.updatedAt) : (order.paidAt ?? order.updatedAt);
  lines.push({
    ...small,
    text:
      t(`pos.order.types.${order.type}`) +
      (order.table ? ` · ${t('pos.table.name', { name: order.table.name })}` : '') +
      ` · ${formatDateTime(when, language)}`,
  });
  if (bill) {
    lines.push({
      kind: 'text',
      text: t('pos.table.notPaid'),
      align: 'center',
      bold: true,
      upper: true,
    });
  }
  lines.push({ ...small, text: t('pos.receipt.cashier', { name: cashier }) });
  if (order.delivery) {
    lines.push({
      ...small,
      text: [
        `${t('pos.receipt.deliverTo')} `,
        ...(order.delivery.name ? [`${order.delivery.name} `] : []),
        { ltr: order.delivery.phone },
      ],
    });
    lines.push({ ...small, text: order.delivery.address });
    if (order.delivery.note) lines.push({ ...small, text: order.delivery.note });
  }
  if (order.customer) {
    lines.push({
      ...small,
      text: [
        `${t('pos.receipt.customer')} `,
        ...(order.customer.name ? [`${order.customer.name} `] : []),
        { ltr: order.customer.phone },
      ],
    });
  }

  lines.push({ kind: 'rule' });
  for (const line of order.lines) {
    if (line.status === 'voided') continue;
    lines.push({
      kind: 'row',
      start: `${line.quantity} × ${name(line.name)}`,
      end: money(line.lineTotal, words),
    });
    if (line.modifiers.length > 0) {
      lines.push({
        kind: 'text',
        text: names(line.modifiers),
        size: 'xs',
        muted: true,
        indent: true,
      });
    }
    for (const choice of line.choices) {
      lines.push({
        kind: 'text',
        text:
          name(choice.name) + (choice.modifiers.length > 0 ? ` (${names(choice.modifiers)})` : ''),
        size: 'xs',
        muted: true,
        indent: true,
      });
    }
  }
  lines.push({ kind: 'rule' });

  lines.push({ kind: 'row', start: t('pos.order.subtotal'), end: money(order.subtotal, words) });
  for (const promotion of order.promotions) {
    lines.push({
      kind: 'row',
      start: name(promotion.name),
      end: money(promotion.amount, words, '− '),
    });
  }
  if (order.discount) {
    lines.push({
      kind: 'row',
      start: t('pos.order.discount'),
      end: money(order.discount.amount, words, '− '),
    });
  }
  if (order.pointsRedeemed > 0) {
    lines.push({
      kind: 'row',
      start: t('pos.points.row', { count: order.pointsRedeemed }),
      end: money(order.pointsDiscount, words, '− '),
    });
  }
  lines.push({
    kind: 'row',
    start: t('pos.order.total'),
    end: money(order.total, words),
    size: 'md',
    bold: true,
  });

  if (!bill && order.payments.length > 0) {
    lines.push({ kind: 'rule' });
    for (const payment of order.payments) {
      lines.push({
        kind: 'row',
        start: payment.reference
          ? [
              `${name(payment.methodName)} (${t('pos.receipt.slip')} `,
              { ltr: payment.reference },
              ')',
            ]
          : name(payment.methodName),
        end: money(payment.tendered ?? payment.amount, words),
      });
    }
    if (order.change !== '0.000') {
      lines.push({
        kind: 'row',
        start: t('pos.pay.change'),
        end: money(order.change, words),
        bold: true,
      });
    }
  }

  if (!bill && order.customer && (order.pointsEarned > 0 || order.pointsRedeemed > 0)) {
    lines.push({ kind: 'rule' });
    if (order.pointsEarned > 0) {
      lines.push({
        kind: 'row',
        start: t('pos.points.earned'),
        end: t('pos.customer.points', { count: order.pointsEarned }),
        size: 'xs',
      });
    }
    lines.push({
      kind: 'row',
      start: t('pos.points.newBalance'),
      end: t('pos.customer.points', { count: order.customer.points }),
      size: 'xs',
    });
  }

  lines.push({ kind: 'gap' });
  lines.push({ ...small, text: bill ? t('pos.table.billThanks') : t('pos.receipt.thanks') });
  return { kind: 'receipt', lines };
}

// The slip handed to the kitchen when the branch works without a kitchen screen, or wants paper
// as well: big type, no prices (docs/specs/027-kitchen-screen-and-slip.md, rule 4). It lists only
// the dishes sent at this moment.
export function kitchenSlipDocument(
  order: Order,
  lineIds: string[],
  terminal: Terminal,
  words: Words,
  now: Date = new Date(),
): PrintDocument {
  const { t, language } = words;
  const name = (text: Parameters<typeof localize>[0]) => localize(text, language);
  const wanted = new Set(lineIds);
  const lines: PrintLine[] = [
    { kind: 'text', text: t('pos.slip.title'), align: 'center', bold: true, upper: true },
    { kind: 'text', text: name(terminal.branchName), align: 'center', size: 'xs' },
    {
      kind: 'text',
      text: t('pos.order.number', { number: order.number }),
      align: 'center',
      size: 'xl',
      bold: true,
    },
    {
      kind: 'text',
      text:
        t(`pos.order.types.${order.type}`) +
        (order.table ? ` · ${t('pos.table.name', { name: order.table.name })}` : ''),
      align: 'center',
      bold: true,
    },
    {
      kind: 'text',
      text: formatDateTime(now.toISOString(), language),
      align: 'center',
      size: 'xs',
    },
    { kind: 'rule' },
  ];

  for (const line of order.lines) {
    if (!wanted.has(line.id) || line.status === 'voided') continue;
    lines.push({
      kind: 'text',
      text: `${line.quantity} × ${name(line.name)}`,
      size: 'lg',
      bold: true,
    });
    if (line.modifiers.length > 0) {
      lines.push({
        kind: 'text',
        text: line.modifiers.map((modifier) => name(modifier.name)).join(', '),
        indent: true,
      });
    }
    for (const choice of line.choices) {
      lines.push({ kind: 'text', text: name(choice.name), indent: true });
    }
    if (line.note) lines.push({ kind: 'text', text: line.note, indent: true, italic: true });
  }
  lines.push({ kind: 'rule' });

  if (order.note) {
    lines.push({ kind: 'text', text: `${t('pos.slip.note')} ${order.note}` });
  }
  return { kind: 'kitchen-slip', lines };
}
