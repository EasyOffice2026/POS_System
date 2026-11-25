import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { type AccountingWebhook, createAccountingNotifier, signNotice } from './notifier';

// The notice to the accounting system after money moves (docs/specs/029-erp-link.md).
const webhook = { url: 'https://accounts.test/api/pos/webhook', secret: 'a-secret-of-sixteen+' };

function appWith(send: typeof fetch, hook: AccountingWebhook | null = webhook) {
  const app = express();
  const v1 = express.Router();
  v1.use(
    createAccountingNotifier(hook ?? undefined, {
      send,
      waitMs: 50,
      now: () => new Date('2026-11-25T10:00:00Z'),
    }),
  );
  v1.post('/orders/:id/pay', (_req, res) => res.json({ ok: true }));
  v1.post('/orders/:id/refunds', (_req, res) => res.status(409).json({ ok: false }));
  v1.post('/orders/:id/lines', (_req, res) => res.json({ ok: true }));
  v1.post('/inventory/purchase-orders/:id/receive', (_req, res) => res.json({ ok: true }));
  app.use('/api/v1', v1);
  return app;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
const answered = () => vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}')));

describe('accounting notifier', () => {
  it('sends one signed notice for a burst of payments', async () => {
    const send = answered();
    const app = appWith(send);
    await request(app).post('/api/v1/orders/a/pay').expect(200);
    await request(app).post('/api/v1/orders/b/pay').expect(200);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] ?? [];
    expect(url).toBe(webhook.url);
    const body = init?.body as string;
    expect(JSON.parse(body)).toEqual({ event: 'figures.changed', at: '2026-11-25T10:00:00.000Z' });
    expect((init?.headers as Record<string, string>)['X-Pos-Signature']).toBe(
      signNotice(webhook.secret, body),
    );
  });

  it('tells about goods receipts too', async () => {
    const send = answered();
    await request(appWith(send)).post('/api/v1/inventory/purchase-orders/x/receive').expect(200);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('stays quiet for failed requests, other requests, or without a webhook', async () => {
    const send = answered();
    const app = appWith(send);
    await request(app).post('/api/v1/orders/a/refunds').expect(409);
    await request(app).post('/api/v1/orders/a/lines').expect(200);
    await request(appWith(send, null)).post('/api/v1/orders/a/pay').expect(200);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps the till working when the accounting system is down', async () => {
    const send = vi.fn<typeof fetch>(() => Promise.reject(new Error('down')));
    await request(appWith(send)).post('/api/v1/orders/a/pay').expect(200);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
