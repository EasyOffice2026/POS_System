import {
  type CancelTransferRequest,
  type CreateTransferRequest,
  fromMils,
  localizedTextSchema,
  type Page,
  type StockTransfer,
  toMils,
  type TransferListQuery,
} from '@pos/shared';
import type {
  Branch as BranchRow,
  Ingredient as IngredientRow,
  MovementKind,
  Prisma,
  StockTransfer as TransferRow,
  StockTransferLine as LineRow,
} from '../../generated/prisma/client';
import { type AuditEvent, writeAudit } from '../../lib/audit';
import { errors } from '../../lib/http-errors';
import { splitPage } from '../../lib/pagination';
import type { PrismaClient } from '../../lib/prisma';
import type { RequestMeta } from '../../lib/request-meta';
import type { ActorContext } from '../../middleware/authenticate';
import type { ScopedClient } from '../../tenancy/scoped-client';
import { invalid } from '../menu/menu.common';
import { toIngredient } from './inventory.service';

export interface TransfersDeps {
  prisma: PrismaClient;
  now: () => Date;
}

const mils = (value: Prisma.Decimal): number => toMils(value.toFixed(3));
const iso = (value: Date | null) => (value ? value.toISOString() : null);

// What a change of stock inside a transfer writes: the movement and the new quantity.
type StockTx = Pick<ScopedClient, 'branchStock' | 'stockMovement'>;

const notSent = () =>
  errors.conflict('TRANSFER_NOT_SENT', 'This transfer was received or cancelled already');

// Stock sent from one branch of a brand to another. See docs/specs/014-stock-transfers.md.
export function createTransfersService({ prisma, now }: TransfersDeps) {
  const audit = (event: AuditEvent, meta: RequestMeta) =>
    writeAudit(prisma, { ...event, ip: meta.ip, userAgent: meta.userAgent });

  const nameOf = async (userId: string) =>
    (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? null;

  // A branch the person works at (the scoped client hides the others).
  async function loadBranch(db: ScopedClient, id: string): Promise<BranchRow> {
    const branch = await db.branch.findUnique({ where: { id } });
    if (!branch) throw errors.notFound('Branch');
    return branch;
  }

  async function loadTransfer(db: ScopedClient, id: string): Promise<TransferRow> {
    const row = await db.stockTransfer.findUnique({ where: { id } });
    if (!row) throw errors.notFound('Transfer');
    return row;
  }

  // A branch-scoped person changes stock only at their own branches (rule 6).
  function assertWritesAt(ctx: ActorContext, branchId: string): void {
    const { auth } = ctx;
    if (auth.scope === 'BRANCH' && !auth.branchIds.includes(branchId)) {
      throw errors.forbidden();
    }
  }

  // Both branches may be out of the person's sight (the other end of the transfer), so their
  // names come through the plain client, within the transfer's brand.
  async function describeMany(rows: TransferRow[]): Promise<StockTransfer[]> {
    if (rows.length === 0) return [];
    const brandId = rows[0]?.brandId ?? '';
    const branchIds = [...new Set(rows.flatMap((row) => [row.fromBranchId, row.toBranchId]))];
    const branches = await prisma.branch.findMany({ where: { id: { in: branchIds }, brandId } });
    const branchOf = new Map(branches.map((branch) => [branch.id, branch]));
    const lines = await prisma.stockTransferLine.findMany({
      where: { transferId: { in: rows.map((row) => row.id) }, brandId },
      orderBy: { id: 'asc' },
    });
    const ingredients = await prisma.ingredient.findMany({
      where: { id: { in: [...new Set(lines.map((line) => line.ingredientId))] }, brandId },
    });
    const ingredientOf = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));

    const branchRef = (id: string) => {
      const branch = branchOf.get(id);
      return { id, name: branch ? localizedTextSchema.parse(branch.name) : { en: '', ar: '' } };
    };
    const toLine = (line: LineRow, ingredient: IngredientRow) => ({
      ingredient: toIngredient(ingredient),
      quantity: line.quantity.toFixed(3),
    });

    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      brandId: row.brandId,
      fromBranch: branchRef(row.fromBranchId),
      toBranch: branchRef(row.toBranchId),
      status: row.status,
      note: row.note,
      lines: lines.flatMap((line) => {
        const ingredient = ingredientOf.get(line.ingredientId);
        return line.transferId === row.id && ingredient ? [toLine(line, ingredient)] : [];
      }),
      sentById: row.sentById,
      sentByName: row.sentByName,
      sentAt: row.sentAt.toISOString(),
      receivedById: row.receivedById,
      receivedByName: row.receivedByName,
      receivedAt: iso(row.receivedAt),
      cancelledById: row.cancelledById,
      cancelledByName: row.cancelledByName,
      cancelledAt: iso(row.cancelledAt),
      cancelReason: row.cancelReason,
    }));
  }

  const describe = async (row: TransferRow): Promise<StockTransfer> =>
    (await describeMany([row]))[0] as StockTransfer;

  // Moves stock at one branch: the row is created on the first movement, the movement and the
  // new quantity are written together (spec 012, rule 4). Sending needs the stock to be there.
  async function moveStock(
    tx: StockTx,
    move: {
      brandId: string;
      branchId: string;
      ingredientId: string;
      kind: MovementKind;
      delta: number;
      note: string;
      referenceId: string;
      by: { id: string; name: string | null };
      at: Date;
      path: string;
    },
  ): Promise<void> {
    const where = {
      branchId_ingredientId: { branchId: move.branchId, ingredientId: move.ingredientId },
    };
    const current = await tx.branchStock.upsert({
      where,
      create: { branchId: move.branchId, ingredientId: move.ingredientId, brandId: move.brandId },
      update: {},
    });
    const after = mils(current.quantity) + move.delta;
    if (after < 0) throw invalid(move.path, 'STOCK_NEGATIVE');
    await tx.stockMovement.create({
      data: {
        brandId: move.brandId,
        branchId: move.branchId,
        ingredientId: move.ingredientId,
        kind: move.kind,
        quantity: fromMils(move.delta),
        quantityAfter: fromMils(after),
        note: move.note,
        referenceId: move.referenceId,
        byId: move.by.id,
        byName: move.by.name,
        createdAt: move.at,
      },
    });
    await tx.branchStock.update({ where, data: { quantity: fromMils(after) } });
  }

  return {
    // The transfers in and out of a branch, newest first.
    async list({ db }: ActorContext, query: TransferListQuery): Promise<Page<StockTransfer>> {
      const branch = await loadBranch(db, query.branchId);
      const rows = await db.stockTransfer.findMany({
        where: {
          OR: [{ fromBranchId: branch.id }, { toBranchId: branch.id }],
          ...(query.status ? { status: query.status } : {}),
        },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      });
      const page = splitPage(rows, query.limit);
      return { data: await describeMany(page.rows), nextCursor: page.nextCursor };
    },

    // The other active branches of the brand, which a branch-scoped person cannot list
    // otherwise (rule 6).
    async destinations(ctx: ActorContext, branchId: string) {
      const branch = await loadBranch(ctx.db, branchId);
      assertWritesAt(ctx, branch.id);
      const branches = await prisma.branch.findMany({
        where: { brandId: branch.brandId, isActive: true, id: { not: branch.id } },
        orderBy: { id: 'asc' },
      });
      return branches.map((row) => ({ id: row.id, name: localizedTextSchema.parse(row.name) }));
    },

    async get({ db }: ActorContext, id: string): Promise<StockTransfer> {
      return describe(await loadTransfer(db, id));
    },

    // Sends: the stock leaves the sender now (rules 1 and 2).
    async send(
      ctx: ActorContext,
      input: CreateTransferRequest,
      meta: RequestMeta,
    ): Promise<StockTransfer> {
      const { auth, db } = ctx;
      const from = await loadBranch(db, input.fromBranchId);
      assertWritesAt(ctx, from.id);
      const to = await prisma.branch.findUnique({ where: { id: input.toBranchId } });
      if (!to || to.brandId !== from.brandId || !to.isActive) {
        throw invalid('toBranchId', 'BRANCH_NOT_FOUND');
      }
      const ingredients = await prisma.ingredient.findMany({
        where: {
          id: { in: input.lines.map((line) => line.ingredientId) },
          brandId: from.brandId,
          isActive: true,
        },
      });
      const known = new Set(ingredients.map((ingredient) => ingredient.id));
      const missing = input.lines.findIndex((line) => !known.has(line.ingredientId));
      if (missing >= 0) throw invalid(`lines.${missing}.ingredientId`, 'INGREDIENT_NOT_FOUND');
      const by = { id: auth.sub, name: await nameOf(auth.sub) };
      const at = now();

      const row = await db.$transaction(async (tx) => {
        const transfer = await tx.stockTransfer.create({
          data: {
            brandId: from.brandId,
            fromBranchId: from.id,
            toBranchId: to.id,
            note: input.note ?? null,
            sentById: by.id,
            sentByName: by.name,
            sentAt: at,
          },
        });
        await tx.stockTransferLine.createMany({
          data: input.lines.map((line) => ({
            transferId: transfer.id,
            brandId: from.brandId,
            fromBranchId: from.id,
            toBranchId: to.id,
            ingredientId: line.ingredientId,
            quantity: line.quantity,
          })),
        });
        for (const [index, line] of input.lines.entries()) {
          await moveStock(tx, {
            brandId: from.brandId,
            branchId: from.id,
            ingredientId: line.ingredientId,
            kind: 'transfer_out',
            delta: -toMils(line.quantity),
            note: `Transfer ${transfer.number}`,
            referenceId: transfer.id,
            by,
            at,
            path: `lines.${index}.quantity`,
          });
        }
        return transfer;
      });
      await audit(
        {
          action: 'inventory.transfer.sent',
          userId: auth.sub,
          brandId: from.brandId,
          branchId: from.id,
          entityType: 'stock_transfer',
          entityId: row.id,
          metadata: { number: row.number, toBranchId: to.id, lines: input.lines.length },
        },
        meta,
      );
      return describe(row);
    },

    // Receives: the stock arrives at the receiver, as sent (rule 3).
    async receive(ctx: ActorContext, id: string, meta: RequestMeta): Promise<StockTransfer> {
      const { auth, db } = ctx;
      const transfer = await loadTransfer(db, id);
      assertWritesAt(ctx, transfer.toBranchId);
      if (transfer.status !== 'sent') throw notSent();
      const by = { id: auth.sub, name: await nameOf(auth.sub) };
      const at = now();

      const row = await db.$transaction(async (tx) => {
        // The status guards against two people receiving at the same moment.
        const changed = await tx.stockTransfer.updateMany({
          where: { id, status: 'sent' },
          data: {
            status: 'received',
            receivedById: by.id,
            receivedByName: by.name,
            receivedAt: at,
          },
        });
        if (changed.count === 0) throw notSent();
        const lines = await tx.stockTransferLine.findMany({ where: { transferId: id } });
        for (const line of lines) {
          await moveStock(tx, {
            brandId: transfer.brandId,
            branchId: transfer.toBranchId,
            ingredientId: line.ingredientId,
            kind: 'transfer_in',
            delta: mils(line.quantity),
            note: `Transfer ${transfer.number}`,
            referenceId: id,
            by,
            at,
            path: 'lines',
          });
        }
        return tx.stockTransfer.findUniqueOrThrow({ where: { id } });
      });
      await audit(
        {
          action: 'inventory.transfer.received',
          userId: auth.sub,
          brandId: transfer.brandId,
          branchId: transfer.toBranchId,
          entityType: 'stock_transfer',
          entityId: id,
          metadata: { number: transfer.number, fromBranchId: transfer.fromBranchId },
        },
        meta,
      );
      return describe(row);
    },

    // Cancels: the stock comes back to the sender (rule 4).
    async cancel(
      ctx: ActorContext,
      id: string,
      input: CancelTransferRequest,
      meta: RequestMeta,
    ): Promise<StockTransfer> {
      const { auth, db } = ctx;
      const transfer = await loadTransfer(db, id);
      assertWritesAt(ctx, transfer.fromBranchId);
      if (transfer.status !== 'sent') throw notSent();
      const by = { id: auth.sub, name: await nameOf(auth.sub) };
      const at = now();

      const row = await db.$transaction(async (tx) => {
        const changed = await tx.stockTransfer.updateMany({
          where: { id, status: 'sent' },
          data: {
            status: 'cancelled',
            cancelledById: by.id,
            cancelledByName: by.name,
            cancelledAt: at,
            cancelReason: input.reason,
          },
        });
        if (changed.count === 0) throw notSent();
        const lines = await tx.stockTransferLine.findMany({ where: { transferId: id } });
        for (const line of lines) {
          await moveStock(tx, {
            brandId: transfer.brandId,
            branchId: transfer.fromBranchId,
            ingredientId: line.ingredientId,
            kind: 'transfer_in',
            delta: mils(line.quantity),
            note: `Transfer ${transfer.number} cancelled: ${input.reason}`,
            referenceId: id,
            by,
            at,
            path: 'lines',
          });
        }
        return tx.stockTransfer.findUniqueOrThrow({ where: { id } });
      });
      await audit(
        {
          action: 'inventory.transfer.cancelled',
          userId: auth.sub,
          brandId: transfer.brandId,
          branchId: transfer.fromBranchId,
          entityType: 'stock_transfer',
          entityId: id,
          metadata: { number: transfer.number, reason: input.reason },
        },
        meta,
      );
      return describe(row);
    },
  };
}

export type TransfersService = ReturnType<typeof createTransfersService>;
