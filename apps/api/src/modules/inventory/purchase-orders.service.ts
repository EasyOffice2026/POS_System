import {
  type CancelPurchaseOrderRequest,
  type CreatePurchaseOrderRequest,
  fromMils,
  localizedTextSchema,
  type Page,
  type PurchaseOrder,
  type PurchaseOrderListQuery,
  type PurchaseOrderSummary,
  type ReceivePurchaseOrderRequest,
  toMils,
  type UpdatePurchaseOrderRequest,
} from '@pos/shared';
import type {
  Prisma,
  PurchaseOrder as OrderRow,
  Supplier as SupplierRow,
} from '../../generated/prisma/client';
import { type AuditEvent, writeAudit } from '../../lib/audit';
import { errors } from '../../lib/http-errors';
import { splitPage } from '../../lib/pagination';
import type { PrismaClient } from '../../lib/prisma';
import type { RequestMeta } from '../../lib/request-meta';
import type { ActorContext } from '../../middleware/authenticate';
import type { ScopedClient } from '../../tenancy/scoped-client';
import { invalid } from '../menu/menu.common';
import { dbDate } from '../orders/orders.common';
import { toIngredient } from './inventory.service';

export interface PurchaseOrdersDeps {
  prisma: PrismaClient;
  now: () => Date;
}

const mils = (value: Prisma.Decimal): number => toMils(value.toFixed(3));
const iso = (value: Date | null) => (value ? value.toISOString() : null);
const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

const notDraft = () => errors.conflict('ORDER_NOT_DRAFT', 'Only a draft order can be changed');
const closed = () =>
  errors.conflict('ORDER_CLOSED', 'This order was received or cancelled already');
const notSent = () => errors.conflict('ORDER_NOT_SENT', 'Only a sent order can be received');

type LineInput = CreatePurchaseOrderRequest['lines'][number];

function summaryOf(row: OrderRow, supplierName: string, lineCount: number): PurchaseOrderSummary {
  return {
    id: row.id,
    number: row.number,
    brandId: row.brandId,
    branchId: row.branchId,
    supplier: { id: row.supplierId, name: supplierName },
    status: row.status,
    expectedOn: day(row.expectedOn),
    note: row.note,
    total: row.total.toFixed(3),
    lineCount,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    sentByName: row.sentByName,
    sentAt: iso(row.sentAt),
    cancelledByName: row.cancelledByName,
    cancelledAt: iso(row.cancelledAt),
    cancelReason: row.cancelReason,
    receivedByName: row.receivedByName,
    receivedAt: iso(row.receivedAt),
    invoiceNumber: row.invoiceNumber,
    receiveNote: row.receiveNote,
    receivedTotal: row.receivedTotal?.toFixed(3) ?? null,
  };
}

// Ingredients ordered for a branch from a supplier. See docs/specs/018-purchase-orders.md.
export function createPurchaseOrdersService({ prisma, now }: PurchaseOrdersDeps) {
  const audit = (event: AuditEvent, meta: RequestMeta) =>
    writeAudit(prisma, { ...event, ip: meta.ip, userAgent: meta.userAgent });

  const nameOf = async (userId: string) =>
    (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? null;

  // A branch, or an order, the person cannot see is answered like one that does not exist.
  async function loadBranch(db: ScopedClient, id: string) {
    const branch = await db.branch.findUnique({ where: { id } });
    if (!branch) throw errors.notFound('Branch');
    return branch;
  }

  async function loadOrder(db: ScopedClient, id: string): Promise<OrderRow> {
    const row = await db.purchaseOrder.findUnique({ where: { id } });
    if (!row) throw errors.notFound('Purchase order');
    return row;
  }

  // The lines as they will be stored: each an active ingredient of the brand, priced from the
  // line or the supplier's list, with its total (rules 2 and 3).
  async function priceLines(db: ScopedClient, supplier: SupplierRow, lines: LineInput[]) {
    const ids = lines.map((line) => line.ingredientId);
    const ingredients = await db.ingredient.findMany({
      where: { id: { in: ids }, brandId: supplier.brandId, isActive: true },
    });
    const known = new Set(ingredients.map((ingredient) => ingredient.id));
    const missing = lines.findIndex((line) => !known.has(line.ingredientId));
    if (missing >= 0) throw invalid(`lines.${missing}.ingredientId`, 'INGREDIENT_NOT_FOUND');

    const prices = await db.supplierPrice.findMany({
      where: { supplierId: supplier.id, ingredientId: { in: ids } },
    });
    const listed = new Map(prices.map((row) => [row.ingredientId, row.price.toFixed(3)]));
    const priced = lines.map((line, index) => {
      const unitPrice = line.unitPrice ?? listed.get(line.ingredientId);
      if (unitPrice === undefined) throw invalid(`lines.${index}.unitPrice`, 'PRICE_REQUIRED');
      const lineTotal = Math.round((toMils(line.quantity) * toMils(unitPrice)) / 1000);
      return { ingredientId: line.ingredientId, quantity: line.quantity, unitPrice, lineTotal };
    });
    return { priced, total: priced.reduce((sum, line) => sum + line.lineTotal, 0) };
  }

  async function describe(db: ScopedClient, row: OrderRow): Promise<PurchaseOrder> {
    const lines = await db.purchaseOrderLine.findMany({ where: { orderId: row.id } });
    const ingredients = await db.ingredient.findMany({
      where: { id: { in: lines.map((line) => line.ingredientId) } },
      orderBy: [{ searchText: 'asc' }, { id: 'asc' }],
    });
    const lineOf = new Map(lines.map((line) => [line.ingredientId, line]));
    const supplier = await db.supplier.findUnique({ where: { id: row.supplierId } });
    const branch = await db.branch.findUnique({ where: { id: row.branchId } });
    return {
      ...summaryOf(row, supplier?.name ?? '', lines.length),
      supplier: {
        id: row.supplierId,
        name: supplier?.name ?? '',
        contactName: supplier?.contactName ?? null,
        phone: supplier?.phone ?? null,
        email: supplier?.email ?? null,
      },
      branch: {
        id: row.branchId,
        name: branch ? localizedTextSchema.parse(branch.name) : { en: '', ar: '' },
        address: branch?.address ?? null,
      },
      lines: ingredients.flatMap((ingredient) => {
        const line = lineOf.get(ingredient.id);
        return line
          ? [
              {
                ingredient: toIngredient(ingredient),
                quantity: line.quantity.toFixed(3),
                unitPrice: line.unitPrice.toFixed(3),
                lineTotal: line.lineTotal.toFixed(3),
                receivedQuantity: line.receivedQuantity?.toFixed(3) ?? null,
                receivedPrice: line.receivedPrice?.toFixed(3) ?? null,
                receivedTotal: line.receivedTotal?.toFixed(3) ?? null,
              },
            ]
          : [];
      }),
    };
  }

  const auditOrder = (
    ctx: ActorContext,
    action: string,
    row: OrderRow,
    metadata: Prisma.InputJsonObject,
    meta: RequestMeta,
  ) =>
    audit(
      {
        action,
        userId: ctx.auth.sub,
        brandId: row.brandId,
        branchId: row.branchId,
        entityType: 'purchase_order',
        entityId: row.id,
        metadata: { number: row.number, ...metadata },
      },
      meta,
    );

  return {
    // The orders of a branch, newest first.
    async list(
      { db }: ActorContext,
      query: PurchaseOrderListQuery,
    ): Promise<Page<PurchaseOrderSummary>> {
      await loadBranch(db, query.branchId);
      const rows = await db.purchaseOrder.findMany({
        where: { branchId: query.branchId, ...(query.status ? { status: query.status } : {}) },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const page = splitPage(rows, query.limit);
      const suppliers = await db.supplier.findMany({
        where: { id: { in: [...new Set(page.rows.map((row) => row.supplierId))] } },
      });
      const nameOfSupplier = new Map(suppliers.map((row) => [row.id, row.name]));
      const counts = await db.purchaseOrderLine.groupBy({
        by: ['orderId'],
        where: { orderId: { in: page.rows.map((row) => row.id) } },
        _count: { _all: true },
      });
      const countOf = new Map(counts.map((count) => [count.orderId, count._count._all]));
      return {
        data: page.rows.map((row) =>
          summaryOf(row, nameOfSupplier.get(row.supplierId) ?? '', countOf.get(row.id) ?? 0),
        ),
        nextCursor: page.nextCursor,
      };
    },

    async get({ db }: ActorContext, id: string): Promise<PurchaseOrder> {
      return describe(db, await loadOrder(db, id));
    },

    // A new draft for a branch and an active supplier of its brand (rule 1).
    async create(
      ctx: ActorContext,
      input: CreatePurchaseOrderRequest,
      meta: RequestMeta,
    ): Promise<PurchaseOrder> {
      const { auth, db } = ctx;
      const branch = await loadBranch(db, input.branchId);
      if (!branch.isActive) throw errors.branchInactive();
      const supplier = await db.supplier.findUnique({ where: { id: input.supplierId } });
      if (!supplier || supplier.brandId !== branch.brandId || !supplier.isActive) {
        throw invalid('supplierId', 'SUPPLIER_NOT_FOUND');
      }
      const { priced, total } = await priceLines(db, supplier, input.lines);
      const byName = await nameOf(auth.sub);

      const row = await db.$transaction(async (tx) => {
        const order = await tx.purchaseOrder.create({
          data: {
            brandId: branch.brandId,
            branchId: branch.id,
            supplierId: supplier.id,
            expectedOn: input.expectedOn ? dbDate(input.expectedOn) : null,
            note: input.note ?? null,
            total: fromMils(total),
            createdById: auth.sub,
            createdByName: byName,
            createdAt: now(),
          },
        });
        await tx.purchaseOrderLine.createMany({
          data: priced.map((line) => ({
            orderId: order.id,
            brandId: branch.brandId,
            branchId: branch.id,
            ingredientId: line.ingredientId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal: fromMils(line.lineTotal),
          })),
        });
        return order;
      });
      await auditOrder(
        ctx,
        'inventory.purchase_order.created',
        row,
        { supplierId: supplier.id, total: row.total.toFixed(3) },
        meta,
      );
      return describe(db, row);
    },

    // Replaces a draft as a whole (rule 4).
    async update(
      ctx: ActorContext,
      id: string,
      input: UpdatePurchaseOrderRequest,
      meta: RequestMeta,
    ): Promise<PurchaseOrder> {
      const { db } = ctx;
      const order = await loadOrder(db, id);
      if (order.status !== 'draft') throw notDraft();
      const supplier = await db.supplier.findUnique({ where: { id: order.supplierId } });
      if (!supplier) throw invalid('supplierId', 'SUPPLIER_NOT_FOUND');
      const { priced, total } = await priceLines(db, supplier, input.lines);

      const row = await db.$transaction(async (tx) => {
        // The status guards against a change racing a send.
        const changed = await tx.purchaseOrder.updateMany({
          where: { id, status: 'draft' },
          data: {
            ...(input.expectedOn === undefined
              ? {}
              : { expectedOn: input.expectedOn ? dbDate(input.expectedOn) : null }),
            ...(input.note === undefined ? {} : { note: input.note }),
            total: fromMils(total),
          },
        });
        if (changed.count === 0) throw notDraft();
        await tx.purchaseOrderLine.deleteMany({ where: { orderId: id } });
        await tx.purchaseOrderLine.createMany({
          data: priced.map((line) => ({
            orderId: id,
            brandId: order.brandId,
            branchId: order.branchId,
            ingredientId: line.ingredientId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal: fromMils(line.lineTotal),
          })),
        });
        return tx.purchaseOrder.findUniqueOrThrow({ where: { id } });
      });
      await auditOrder(
        ctx,
        'inventory.purchase_order.updated',
        row,
        { lines: priced.length, total: row.total.toFixed(3) },
        meta,
      );
      return describe(db, row);
    },

    // Fixes a draft; it changes no stock (rule 5).
    async send(ctx: ActorContext, id: string, meta: RequestMeta): Promise<PurchaseOrder> {
      const { auth, db } = ctx;
      const order = await loadOrder(db, id);
      if (order.status !== 'draft') throw notDraft();
      const changed = await db.purchaseOrder.updateMany({
        where: { id, status: 'draft' },
        data: {
          status: 'sent',
          sentById: auth.sub,
          sentByName: await nameOf(auth.sub),
          sentAt: now(),
        },
      });
      if (changed.count === 0) throw notDraft();
      const row = await loadOrder(db, id);
      await auditOrder(
        ctx,
        'inventory.purchase_order.sent',
        row,
        { total: row.total.toFixed(3) },
        meta,
      );
      return describe(db, row);
    },

    // Cancels a draft or a sent order (rule 6).
    async cancel(
      ctx: ActorContext,
      id: string,
      input: CancelPurchaseOrderRequest,
      meta: RequestMeta,
    ): Promise<PurchaseOrder> {
      const { auth, db } = ctx;
      const order = await loadOrder(db, id);
      if (order.status !== 'draft' && order.status !== 'sent') throw closed();
      const changed = await db.purchaseOrder.updateMany({
        where: { id, status: { in: ['draft', 'sent'] } },
        data: {
          status: 'cancelled',
          cancelledById: auth.sub,
          cancelledByName: await nameOf(auth.sub),
          cancelledAt: now(),
          cancelReason: input.reason,
        },
      });
      if (changed.count === 0) throw closed();
      const row = await loadOrder(db, id);
      await auditOrder(
        ctx,
        'inventory.purchase_order.cancelled',
        row,
        { reason: input.reason },
        meta,
      );
      return describe(db, row);
    },

    // Receives a sent order in one go and puts what arrived into the branch's stock.
    // See docs/specs/019-goods-receipt.md.
    async receive(
      ctx: ActorContext,
      id: string,
      input: ReceivePurchaseOrderRequest,
      meta: RequestMeta,
    ): Promise<PurchaseOrder> {
      const { auth, db } = ctx;
      const order = await loadOrder(db, id);
      if (order.status !== 'sent') throw notSent();
      const lines = await db.purchaseOrderLine.findMany({ where: { orderId: id } });
      const onOrder = new Set(lines.map((line) => line.ingredientId));
      const missing = input.lines.findIndex((line) => !onOrder.has(line.ingredientId));
      if (missing >= 0) throw invalid(`lines.${missing}.ingredientId`, 'INGREDIENT_NOT_FOUND');
      const given = new Map(input.lines.map((line) => [line.ingredientId, line]));
      const by = { id: auth.sub, name: await nameOf(auth.sub) };
      const at = now();

      // Each line of the order as received: left out is 0, and the order's price unless another
      // was typed (rules 2 and 3).
      const received = lines.map((line) => {
        const typed = given.get(line.ingredientId);
        const quantity = typed ? toMils(typed.quantity) : 0;
        const price = typed?.unitPrice ? toMils(typed.unitPrice) : mils(line.unitPrice);
        return { line, quantity, price, total: Math.round((quantity * price) / 1000) };
      });
      const total = received.reduce((sum, row) => sum + row.total, 0);
      const differing = received.filter(
        (row) => row.quantity !== mils(row.line.quantity) || row.price !== mils(row.line.unitPrice),
      ).length;

      const row = await db.$transaction(async (tx) => {
        // The status guards against two people receiving the same delivery.
        const changed = await tx.purchaseOrder.updateMany({
          where: { id, status: 'sent' },
          data: {
            status: 'received',
            receivedById: by.id,
            receivedByName: by.name,
            receivedAt: at,
            invoiceNumber: input.invoiceNumber ?? null,
            receiveNote: input.note ?? null,
            receivedTotal: fromMils(total),
          },
        });
        if (changed.count === 0) throw notSent();
        for (const { line, quantity, price, total: lineTotal } of received) {
          await tx.purchaseOrderLine.update({
            where: { id: line.id },
            data: {
              receivedQuantity: fromMils(quantity),
              receivedPrice: fromMils(price),
              receivedTotal: fromMils(lineTotal),
            },
          });
          if (quantity === 0) continue;
          // The stock goes up by what arrived (rule 4).
          const where = {
            branchId_ingredientId: { branchId: order.branchId, ingredientId: line.ingredientId },
          };
          const stock = await tx.branchStock.upsert({
            where,
            create: {
              branchId: order.branchId,
              ingredientId: line.ingredientId,
              brandId: order.brandId,
            },
            update: {},
          });
          const after = mils(stock.quantity) + quantity;
          await tx.stockMovement.create({
            data: {
              brandId: order.brandId,
              branchId: order.branchId,
              ingredientId: line.ingredientId,
              kind: 'received',
              quantity: fromMils(quantity),
              quantityAfter: fromMils(after),
              note: `Purchase order ${order.number}`,
              referenceId: id,
              byId: by.id,
              byName: by.name,
              createdAt: at,
            },
          });
          await tx.branchStock.update({ where, data: { quantity: fromMils(after) } });
        }
        return tx.purchaseOrder.findUniqueOrThrow({ where: { id } });
      });
      await auditOrder(
        ctx,
        'inventory.purchase_order.received',
        row,
        { receivedTotal: fromMils(total), differing },
        meta,
      );
      return describe(db, row);
    },
  };
}

export type PurchaseOrdersService = ReturnType<typeof createPurchaseOrdersService>;
