import type { BridgePrintJob } from '@pos/shared';
import { createServer as createHttpServer, type Server } from 'node:http';
import {
  type AddressInfo,
  createServer as createTcpServer,
  type Server as TcpServer,
} from 'node:net';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBridge } from './bridge';

// A POS as the bridge sees it: a queue of jobs, and what the bridge reported.
function fakePos(key = 'pb_test') {
  const queue: BridgePrintJob[] = [];
  const reported: { id: string; status: string; error?: string }[] = [];
  let claims = 0;
  const server: Server = createHttpServer((req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${key}`) {
      json(401, { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue' } });
      return;
    }
    const url = req.url ?? '';
    if (req.method === 'GET' && url === '/api/v1/print-bridge') {
      json(200, {
        branchId: '01990000-0000-7000-8000-000000000011',
        branchName: { en: 'Mall', ar: 'المول' },
        printers: [],
      });
      return;
    }
    if (req.method === 'POST' && url === '/api/v1/print-bridge/jobs/claim') {
      claims++;
      const job = queue.shift();
      if (job) json(200, job);
      else {
        res.writeHead(204);
        res.end();
      }
      return;
    }
    const done = /^\/api\/v1\/print-bridge\/jobs\/([^/]+)\/(done|failed)$/.exec(url);
    if (req.method === 'POST' && done) {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        const parsed = body ? (JSON.parse(body) as { error?: string }) : {};
        reported.push({ id: done[1] ?? '', status: done[2] ?? '', ...parsed });
        res.writeHead(204);
        res.end();
      });
      return;
    }
    json(404, { error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
  return {
    queue,
    reported,
    claims: () => claims,
    async start() {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// A printer on the network: it takes bytes and keeps them.
function fakePrinter() {
  const received: Buffer[] = [];
  const server: TcpServer = createTcpServer((socket) => {
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => received.push(Buffer.concat(chunks)));
  });
  return {
    received,
    async start() {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      return { host: '127.0.0.1', port: (server.address() as AddressInfo).port };
    },
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function smallPng(): string {
  const png = new PNG({ width: 8, height: 2 });
  png.data.fill(255);
  png.data[0] = png.data[1] = png.data[2] = 0;
  return PNG.sync.write(png).toString('base64');
}

function job(printer: { host: string; port: number }, id = '01990000-0000-7000-8000-0000000000c1') {
  return {
    id,
    branchId: '01990000-0000-7000-8000-000000000011',
    printerId: '01990000-0000-7000-8000-0000000000a1',
    printerName: 'Cash desk',
    kind: 'receipt' as const,
    status: 'printing' as const,
    orderNumber: 7,
    attempts: 1,
    error: null,
    createdAt: '2026-11-01T09:00:00.000Z',
    finishedAt: null,
    image: smallPng(),
    printer,
  };
}

describe('the bridge', () => {
  const pos = fakePos();
  const printer = fakePrinter();
  let apiUrl = '';
  let address = { host: '127.0.0.1', port: 0 };
  const log: string[] = [];
  const naps: number[] = [];
  const sleep = (ms: number) => {
    naps.push(ms);
    return Promise.resolve();
  };

  beforeEach(async () => {
    apiUrl = await pos.start();
    address = await printer.start();
    log.length = 0;
    naps.length = 0;
    pos.reported.length = 0;
  });
  afterEach(async () => {
    await pos.stop();
    await printer.stop();
  });

  const bridgeWith = (key = 'pb_test') =>
    createBridge({ apiUrl, key, printerTimeoutMs: 1000, log: (line) => log.push(line), sleep });

  it('learns its branch, takes a job, sends it to the printer and reports it done', async () => {
    const bridge = bridgeWith();
    expect((await bridge.info()).branchName.en).toBe('Mall');
    pos.queue.push(job(address));

    expect(await bridge.once()).toBe(true);
    // The printer heard the reset first and the cut last.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(printer.received).toHaveLength(1);
    expect([...(printer.received[0]?.subarray(0, 2) ?? [])]).toEqual([0x1b, 0x40]);
    expect([...(printer.received[0]?.subarray(-3) ?? [])]).toEqual([0x56, 0x42, 0x00]);
    expect(pos.reported).toEqual([{ id: '01990000-0000-7000-8000-0000000000c1', status: 'done' }]);
    expect(log).toEqual(['Printed receipt of order 7 on Cash desk']);

    // Nothing more to do.
    expect(await bridge.once()).toBe(false);
  });

  it('tries three times a few seconds apart, then reports why it failed', async () => {
    const bridge = bridgeWith();
    await printer.stop();
    pos.queue.push(job(address));

    expect(await bridge.once()).toBe(true);

    expect(naps).toEqual([3000, 3000]);
    expect(pos.reported).toHaveLength(1);
    expect(pos.reported[0]).toMatchObject({ status: 'failed' });
    expect(pos.reported[0]?.error).toMatch(
      /^The printer at 127\.0\.0\.1:\d+ refused the connection$/,
    );
    expect(log).toHaveLength(3);
    expect(log[0]).toContain('(try 1 of 3)');
    // The printer is started again for the next test.
    address = await printer.start();
  });

  it('refuses to run with a key the POS does not know', async () => {
    const bridge = bridgeWith('pb_wrong');

    await expect(bridge.once()).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });
});
