import {
  apiErrorSchema,
  type BridgePrintJob,
  bridgePrintJobSchema,
  type PrintBridgeInfo,
  printBridgeInfoSchema,
} from '@pos/shared';
import { escposFromPng } from './escpos';
import { type PrinterAddress, sendToPrinter } from './printer';

// The bridge's loop (docs/specs/028-print-bridge.md, rule 3): ask the POS for the next job of
// the branch, send it to its printer, say whether it printed, ask again. A job that cannot be
// sent is tried three times, a few seconds apart, before it is given up.

export interface BridgeOptions {
  apiUrl: string;
  key: string;
  printerTimeoutMs: number;
  fetch?: typeof fetch;
  send?: (printer: PrinterAddress, data: Buffer, timeoutMs: number) => Promise<void>;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export const SEND_TRIES = 3;
const RETRY_AFTER_MS = 3000;
// After the POS could not be reached.
const BACKOFF_MS = 5000;

export class ApiRefused extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRefused';
  }
}

export function createBridge({
  apiUrl,
  key,
  printerTimeoutMs,
  fetch: doFetch = fetch,
  send = sendToPrinter,
  log = (line) => console.log(line),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: BridgeOptions) {
  async function call(path: string, body?: unknown): Promise<unknown> {
    const res = await doFetch(`${apiUrl}/api/v1/print-bridge${path}`, {
      method: body === undefined && path === '' ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return null;
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const parsed = apiErrorSchema.safeParse(json);
      const code = parsed.success ? parsed.data.error.code : 'UNKNOWN';
      const message = parsed.success ? parsed.data.error.message : res.statusText;
      throw new ApiRefused(res.status, code, message);
    }
    return json;
  }

  async function info(): Promise<PrintBridgeInfo> {
    return printBridgeInfoSchema.parse(await call(''));
  }

  async function claim(): Promise<BridgePrintJob | null> {
    const json = await call('/jobs/claim', {});
    return json === null ? null : bridgePrintJobSchema.parse(json);
  }

  // Sends one job to its printer: the picture as ESC/POS, tried a few times.
  async function print(job: BridgePrintJob): Promise<void> {
    const data = escposFromPng(Buffer.from(job.image, 'base64'));
    const what = `${job.kind}${job.orderNumber === null ? '' : ` of order ${job.orderNumber}`} on ${job.printerName}`;
    let lastError = '';
    for (let attempt = 1; attempt <= SEND_TRIES; attempt++) {
      try {
        await send(job.printer, data, printerTimeoutMs);
        log(`Printed ${what}`);
        await call(`/jobs/${job.id}/done`, {});
        return;
      } catch (error) {
        if (error instanceof ApiRefused) throw error;
        lastError = error instanceof Error ? error.message : String(error);
        log(`Could not print ${what} (try ${attempt} of ${SEND_TRIES}): ${lastError}`);
        if (attempt < SEND_TRIES) await sleep(RETRY_AFTER_MS);
      }
    }
    await call(`/jobs/${job.id}/failed`, { error: lastError });
  }

  // One turn of the loop: the next job, printed. Answers whether there was one.
  async function once(): Promise<boolean> {
    const job = await claim();
    if (!job) return false;
    await print(job);
    return true;
  }

  let stopped = false;

  async function run(): Promise<void> {
    const me = await info();
    log(
      `Printing for ${me.branchName.en}: ${me.printers.length} printer(s)` +
        me.printers
          .map(
            (printer) => `\n  ${printer.name} (${printer.kind}) at ${printer.host}:${printer.port}`,
          )
          .join(''),
    );
    while (!stopped) {
      try {
        await once();
      } catch (error) {
        if (error instanceof ApiRefused && error.status === 401) {
          log('The key was refused by the POS. Make a new one on the branch’s Printers tab.');
        } else {
          log(`Cannot reach the POS: ${error instanceof Error ? error.message : String(error)}`);
        }
        await sleep(BACKOFF_MS);
      }
    }
  }

  return {
    info,
    claim,
    print,
    once,
    run,
    stop() {
      stopped = true;
    },
  };
}

export type Bridge = ReturnType<typeof createBridge>;
