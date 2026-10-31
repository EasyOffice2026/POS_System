import {
  type BridgePrintJob,
  type CreatePrintJobRequest,
  type LocalizedText,
  MAX_PRINT_IMAGE_BYTES,
  PRINT_BRIDGE_KEY_PREFIX,
  PRINT_JOB_MAX_ATTEMPTS,
  PRINT_JOB_STALE_SECONDS,
  parseBranchConfig,
  type Printer,
  printerKindFor,
  type PrintBridgeInfo,
  type PrintBridgeKey,
  type PrintBridgeKeyInfo,
  type PrintJob,
} from '@pos/shared';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { PrintJob as PrintJobRow } from '../../generated/prisma/client';
import { writeAudit } from '../../lib/audit';
import { errors } from '../../lib/http-errors';
import type { PrismaClient } from '../../lib/prisma';
import type { RequestMeta } from '../../lib/request-meta';
import type { ActorContext } from '../../middleware/authenticate';

// Printing without the browser (docs/specs/028-print-bridge.md). A till leaves a job (a picture
// of the receipt or the slip) for the bridge of its branch; the bridge takes the jobs one by one,
// sends each to the printer, and says whether it printed.

export interface PrintingDeps {
  prisma: PrismaClient;
  now: () => Date;
}

// The bridge that is asking, once its key has been checked.
export interface BridgeContext {
  branchId: string;
  brandId: string;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Finished jobs are kept this long, for a look at what went wrong, then thrown away.
const KEEP_FINISHED_MS = 7 * 24 * 60 * 60 * 1000;
const POLL_MS = 1000;

export function hashBridgeKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function toJob(row: PrintJobRow, printerName: string): PrintJob {
  return {
    id: row.id,
    branchId: row.branchId,
    printerId: row.printerId,
    printerName,
    kind: row.kind,
    status: row.status,
    orderNumber: row.orderNumber,
    attempts: row.attempts,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export function createPrintingService({ prisma, now }: PrintingDeps) {
  // The printers of a branch, by id. A printer that was removed is simply not there.
  async function printersOf(branchId: string): Promise<Map<string, Printer>> {
    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    const printers = branch ? parseBranchConfig(branch.config).printers : [];
    return new Map(printers.map((printer) => [printer.id, printer]));
  }

  // Marks a job the bridge could not print, or that no bridge finished.
  function giveUp(id: string, error: string, at: Date) {
    return prisma.printJob.updateMany({
      where: { id, status: { in: ['queued', 'printing'] } },
      data: { status: 'failed', error, finishedAt: at },
    });
  }

  // The oldest job of the branch that is waiting, or that a bridge took too long ago. Two bridges
  // of one branch cannot take the same job: the row is changed only if nobody changed it first.
  async function takeNext(bridge: BridgeContext): Promise<BridgePrintJob | null> {
    const at = now();
    const stale = new Date(at.getTime() - PRINT_JOB_STALE_SECONDS * 1000);

    await prisma.printJob.updateMany({
      where: {
        branchId: bridge.branchId,
        status: 'printing',
        claimedAt: { lt: stale },
        attempts: { gte: PRINT_JOB_MAX_ATTEMPTS },
      },
      data: { status: 'failed', error: 'The print bridge stopped while printing', finishedAt: at },
    });
    await prisma.printJob.deleteMany({
      where: {
        branchId: bridge.branchId,
        status: { in: ['done', 'failed'] },
        createdAt: { lt: new Date(at.getTime() - KEEP_FINISHED_MS) },
      },
    });

    const printers = await printersOf(bridge.branchId);
    for (let tries = 0; tries < 5; tries++) {
      const candidate = await prisma.printJob.findFirst({
        where: {
          branchId: bridge.branchId,
          OR: [
            { status: 'queued' },
            {
              status: 'printing',
              claimedAt: { lt: stale },
              attempts: { lt: PRINT_JOB_MAX_ATTEMPTS },
            },
          ],
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!candidate) return null;

      const printer = printers.get(candidate.printerId);
      if (!printer) {
        await giveUp(candidate.id, 'The printer was removed from the branch', at);
        continue;
      }

      const taken = await prisma.printJob.updateMany({
        where: { id: candidate.id, status: candidate.status, claimedAt: candidate.claimedAt },
        data: { status: 'printing', claimedAt: at, attempts: { increment: 1 } },
      });
      if (taken.count !== 1) continue;

      const row = await prisma.printJob.findUniqueOrThrow({ where: { id: candidate.id } });
      return {
        ...toJob(row, printer.name),
        image: Buffer.from(row.image).toString('base64'),
        printer: { host: printer.host, port: printer.port },
      };
    }
    return null;
  }

  return {
    // A till leaves a job for one of the printers of its branch (rule 2).
    async create(ctx: ActorContext, input: CreatePrintJobRequest): Promise<PrintJob> {
      const branch = await ctx.db.branch.findUnique({ where: { id: input.branchId } });
      if (!branch) throw errors.notFound('Branch');

      const printer = parseBranchConfig(branch.config).printers.find(
        (candidate) =>
          candidate.id === input.printerId && candidate.kind === printerKindFor(input.kind),
      );
      if (!printer) throw errors.notFound('Printer');

      const image = Buffer.from(input.image, 'base64');
      if (image.length > MAX_PRINT_IMAGE_BYTES || !image.subarray(0, 8).equals(PNG_SIGNATURE)) {
        throw errors.validation([{ path: 'image', message: 'PRINT_IMAGE_INVALID' }]);
      }

      const row = await ctx.db.printJob.create({
        data: {
          brandId: branch.brandId,
          branchId: branch.id,
          printerId: printer.id,
          kind: input.kind,
          orderNumber: input.orderNumber ?? null,
          image,
          createdById: ctx.auth.sub,
        },
      });
      return toJob(row, printer.name);
    },

    // The till asks whether its job printed (rule 5).
    async get(ctx: ActorContext, id: string): Promise<PrintJob> {
      const row = await ctx.db.printJob.findUnique({ where: { id } });
      if (!row) throw errors.notFound('Print job');
      const printers = await printersOf(row.branchId);
      return toJob(row, printers.get(row.printerId)?.name ?? '');
    },

    // --- The bridge ---

    // The branch a key belongs to, or null for a key that is not known. A key of a branch that
    // was made inactive is refused like a till's sign-in.
    async authenticateBridge(key: string): Promise<BridgeContext | null> {
      if (!key.startsWith(PRINT_BRIDGE_KEY_PREFIX)) return null;
      const row = await prisma.printBridgeKey.findUnique({
        where: { keyHash: hashBridgeKey(key) },
      });
      if (!row) return null;
      const branch = await prisma.branch.findUnique({ where: { id: row.branchId } });
      if (!branch) return null;
      if (!branch.isActive) throw errors.branchInactive();
      return { branchId: branch.id, brandId: branch.brandId };
    },

    async info(bridge: BridgeContext): Promise<PrintBridgeInfo> {
      const branch = await prisma.branch.findUniqueOrThrow({ where: { id: bridge.branchId } });
      return {
        branchId: branch.id,
        branchName: branch.name as LocalizedText,
        printers: parseBranchConfig(branch.config).printers,
      };
    },

    // The next job, waiting up to waitMs for one to arrive so the bridge need not ask every
    // second (rule 3).
    async claim(bridge: BridgeContext, waitMs: number): Promise<BridgePrintJob | null> {
      const deadline = Date.now() + waitMs;
      for (;;) {
        const job = await takeNext(bridge);
        if (job) return job;
        const left = deadline - Date.now();
        if (left <= 0) return null;
        await sleep(Math.min(POLL_MS, left));
      }
    },

    async done(bridge: BridgeContext, id: string): Promise<void> {
      const result = await prisma.printJob.updateMany({
        where: { id, branchId: bridge.branchId, status: 'printing' },
        data: { status: 'done', error: null, finishedAt: now() },
      });
      if (result.count === 0) throw errors.notFound('Print job');
    },

    async failed(bridge: BridgeContext, id: string, error: string): Promise<void> {
      const result = await prisma.printJob.updateMany({
        where: { id, branchId: bridge.branchId, status: 'printing' },
        data: { status: 'failed', error, finishedAt: now() },
      });
      if (result.count === 0) throw errors.notFound('Print job');
    },

    // --- The key (rule 4) ---

    async keyInfo(ctx: ActorContext, branchId: string): Promise<PrintBridgeKeyInfo> {
      const branch = await ctx.db.branch.findUnique({ where: { id: branchId } });
      if (!branch) throw errors.notFound('Branch');
      const row = await ctx.db.printBridgeKey.findUnique({ where: { branchId } });
      return { createdAt: row?.createdAt.toISOString() ?? null };
    },

    // A new key for the branch's bridge. The old one stops working at once. Only the hash is
    // kept, so the key is shown once and never again.
    async createKey(
      ctx: ActorContext,
      branchId: string,
      meta: RequestMeta,
    ): Promise<PrintBridgeKey> {
      const branch = await ctx.db.branch.findUnique({ where: { id: branchId } });
      if (!branch) throw errors.notFound('Branch');

      const key = `${PRINT_BRIDGE_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
      const at = now();
      await ctx.db.printBridgeKey.upsert({
        where: { branchId },
        create: {
          branchId,
          brandId: branch.brandId,
          keyHash: hashBridgeKey(key),
          createdById: ctx.auth.sub,
          createdAt: at,
        },
        update: { keyHash: hashBridgeKey(key), createdById: ctx.auth.sub, createdAt: at },
      });
      await writeAudit(prisma, {
        action: 'branch.print_bridge_key_created',
        userId: ctx.auth.sub,
        brandId: branch.brandId,
        branchId,
        entityType: 'branch',
        entityId: branchId,
        ...meta,
      });
      return { key, createdAt: at.toISOString() };
    },
  };
}

export type PrintingService = ReturnType<typeof createPrintingService>;
