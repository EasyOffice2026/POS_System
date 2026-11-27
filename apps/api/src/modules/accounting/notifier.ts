import { createHmac } from 'node:crypto';
import type { RequestHandler } from 'express';

// Tells the accounting system that money moved, so it fetches the figures at once instead of
// waiting for its next check. The notice carries no figures: the accounting system reads them
// with its integration key, as always (docs/specs/029-erp-link.md).
export interface AccountingWebhook {
  url: string;
  secret: string;
}

// What changes a day's figures: a payment, a refund, a void, a goods receipt.
const MONEY_MOVES = [
  /^\/orders\/[^/]+\/(pay|refunds|void)$/,
  /^\/inventory\/purchase-orders\/[^/]+\/receive$/,
];

export const SIGNATURE_HEADER = 'X-Pos-Signature';

export function signNotice(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function createAccountingNotifier(
  webhook: AccountingWebhook | undefined,
  {
    send = fetch,
    waitMs = 500,
    now = () => new Date(),
  }: { send?: typeof fetch; waitMs?: number; now?: () => Date } = {},
): RequestHandler {
  let timer: NodeJS.Timeout | undefined;

  const notify = () => {
    if (!webhook || timer) return;
    // A burst of payments becomes one notice.
    timer = setTimeout(() => {
      timer = undefined;
      const body = JSON.stringify({ event: 'figures.changed', at: now().toISOString() });
      send(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [SIGNATURE_HEADER]: signNotice(webhook.secret, body),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      }).catch(() => {
        // The accounting system also checks on its own every few minutes.
      });
    }, waitMs);
    timer.unref?.();
  };

  return (req, res, next) => {
    if (webhook && req.method === 'POST' && MONEY_MOVES.some((path) => path.test(req.path))) {
      res.on('finish', () => {
        if (res.statusCode < 400) notify();
      });
    }
    next();
  };
}
