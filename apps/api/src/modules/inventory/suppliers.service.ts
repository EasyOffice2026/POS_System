import {
  type CreateSupplierRequest,
  normalizeSearchText,
  type Page,
  type PutSupplierPricesRequest,
  type Supplier,
  type SupplierDetail,
  type SupplierListQuery,
  type UpdateSupplierRequest,
} from '@pos/shared';
import type { Prisma, Supplier as SupplierRow } from '../../generated/prisma/client';
import { type AuditEvent, writeAudit } from '../../lib/audit';
import { errors } from '../../lib/http-errors';
import { cursorPageArgs, toPage } from '../../lib/pagination';
import type { PrismaClient } from '../../lib/prisma';
import type { RequestMeta } from '../../lib/request-meta';
import type { ActorContext } from '../../middleware/authenticate';
import type { ScopedClient } from '../../tenancy/scoped-client';
import { invalid, LIST_LIMIT, resolveBrandId, statusFilter } from '../menu/menu.common';
import { isUniqueViolation } from '../orders/orders.common';
import { toIngredient } from './inventory.service';

export interface SuppliersDeps {
  prisma: PrismaClient;
  now: () => Date;
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (character) => `\\${character}`);

function toSupplier(row: SupplierRow, priceCount: number): Supplier {
  return {
    id: row.id,
    brandId: row.brandId,
    name: row.name,
    contactName: row.contactName,
    phone: row.phone,
    email: row.email,
    address: row.address,
    paymentDays: row.paymentDays,
    notes: row.notes,
    isActive: row.isActive,
    priceCount,
  };
}

const nameTaken = () => invalid('name', 'SUPPLIER_NAME_TAKEN');

// Who a brand buys from, and at what price. See docs/specs/017-suppliers.md.
export function createSuppliersService({ prisma, now }: SuppliersDeps) {
  const audit = (event: AuditEvent, meta: RequestMeta) =>
    writeAudit(prisma, { ...event, ip: meta.ip, userAgent: meta.userAgent });

  // A supplier the person cannot see is answered like one that does not exist.
  async function loadSupplier(db: ScopedClient, id: string): Promise<SupplierRow> {
    const row = await db.supplier.findUnique({ where: { id } });
    if (!row) throw errors.notFound('Supplier');
    return row;
  }

  async function describe(db: ScopedClient, row: SupplierRow): Promise<SupplierDetail> {
    const prices = await db.supplierPrice.findMany({ where: { supplierId: row.id } });
    const ingredients = await db.ingredient.findMany({
      where: { id: { in: prices.map((price) => price.ingredientId) } },
      orderBy: [{ searchText: 'asc' }, { id: 'asc' }],
    });
    const priceOf = new Map(prices.map((price) => [price.ingredientId, price]));
    return {
      ...toSupplier(row, prices.length),
      prices: ingredients.flatMap((ingredient) => {
        const price = priceOf.get(ingredient.id);
        return price
          ? [
              {
                ingredient: toIngredient(ingredient),
                price: price.price.toFixed(3),
                updatedAt: price.updatedAt.toISOString(),
              },
            ]
          : [];
      }),
    };
  }

  return {
    async list({ db }: ActorContext, query: SupplierListQuery): Promise<Page<Supplier>> {
      const filters: Prisma.SupplierWhereInput[] = [];
      if (query.brandId) filters.push({ brandId: query.brandId });
      filters.push(statusFilter(query.status));
      // Every word typed has to be somewhere in the name (rule 5).
      for (const word of normalizeSearchText(query.q ?? '').split(' ')) {
        if (word) filters.push({ searchText: { contains: escapeLike(word) } });
      }
      const rows = await db.supplier.findMany({
        where: { AND: filters },
        ...cursorPageArgs(LIST_LIMIT, undefined),
        orderBy: [{ searchText: 'asc' }, { id: 'asc' }],
      });
      const counts = await db.supplierPrice.groupBy({
        by: ['supplierId'],
        where: { supplierId: { in: rows.map((row) => row.id) } },
        _count: { _all: true },
      });
      const countOf = new Map(counts.map((count) => [count.supplierId, count._count._all]));
      return toPage(rows, LIST_LIMIT, (row) => toSupplier(row, countOf.get(row.id) ?? 0));
    },

    async get({ db }: ActorContext, id: string): Promise<SupplierDetail> {
      return describe(db, await loadSupplier(db, id));
    },

    async create(
      ctx: ActorContext,
      input: CreateSupplierRequest,
      meta: RequestMeta,
    ): Promise<SupplierDetail> {
      const { auth, db } = ctx;
      const brandId = await resolveBrandId(ctx, input.brandId);
      let row: SupplierRow;
      try {
        row = await db.supplier.create({
          data: {
            brandId,
            name: input.name,
            searchText: normalizeSearchText(input.name),
            contactName: input.contactName ?? null,
            phone: input.phone ?? null,
            email: input.email ?? null,
            address: input.address ?? null,
            paymentDays: input.paymentDays,
            notes: input.notes ?? null,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw nameTaken();
        throw error;
      }
      await audit(
        {
          action: 'inventory.supplier.created',
          userId: auth.sub,
          brandId,
          entityType: 'supplier',
          entityId: row.id,
          metadata: { name: row.name },
        },
        meta,
      );
      return describe(db, row);
    },

    async update(
      ctx: ActorContext,
      id: string,
      input: UpdateSupplierRequest,
      meta: RequestMeta,
    ): Promise<SupplierDetail> {
      const { auth, db } = ctx;
      const target = await loadSupplier(db, id);
      const data: Prisma.SupplierUpdateInput = {};
      const changed: string[] = [];
      const set = <K extends keyof UpdateSupplierRequest & keyof SupplierRow>(key: K) => {
        const value = input[key];
        if (value !== undefined && value !== target[key]) {
          (data as Record<string, unknown>)[key] = value;
          changed.push(key);
        }
      };
      set('name');
      set('contactName');
      set('phone');
      set('email');
      set('address');
      set('paymentDays');
      set('notes');
      set('isActive');
      if (changed.includes('name') && input.name) data.searchText = normalizeSearchText(input.name);
      if (changed.length === 0) return describe(db, target);

      let row: SupplierRow;
      try {
        row = await db.supplier.update({ where: { id }, data });
      } catch (error) {
        if (isUniqueViolation(error)) throw nameTaken();
        throw error;
      }
      await audit(
        {
          action: 'inventory.supplier.updated',
          userId: auth.sub,
          brandId: target.brandId,
          entityType: 'supplier',
          entityId: id,
          metadata: { changed },
        },
        meta,
      );
      return describe(db, row);
    },

    // Replaces the price list; a price that did not change keeps its time (rule 3).
    async putPrices(
      ctx: ActorContext,
      id: string,
      input: PutSupplierPricesRequest,
      meta: RequestMeta,
    ): Promise<SupplierDetail> {
      const { auth, db } = ctx;
      const supplier = await loadSupplier(db, id);
      const ingredients = await db.ingredient.findMany({
        where: {
          id: { in: input.prices.map((line) => line.ingredientId) },
          brandId: supplier.brandId,
          isActive: true,
        },
      });
      const known = new Set(ingredients.map((ingredient) => ingredient.id));
      const missing = input.prices.findIndex((line) => !known.has(line.ingredientId));
      if (missing >= 0) throw invalid(`prices.${missing}.ingredientId`, 'INGREDIENT_NOT_FOUND');

      const at = now();
      await db.$transaction(async (tx) => {
        const current = await tx.supplierPrice.findMany({ where: { supplierId: id } });
        const before = new Map(current.map((row) => [row.ingredientId, row]));
        await tx.supplierPrice.deleteMany({ where: { supplierId: id } });
        if (input.prices.length > 0) {
          await tx.supplierPrice.createMany({
            data: input.prices.map((line) => {
              const old = before.get(line.ingredientId);
              const same = old?.price.toFixed(3) === line.price;
              return {
                supplierId: id,
                ingredientId: line.ingredientId,
                brandId: supplier.brandId,
                price: line.price,
                updatedAt: same && old ? old.updatedAt : at,
              };
            }),
          });
        }
      });
      await audit(
        {
          action: 'inventory.supplier.prices_updated',
          userId: auth.sub,
          brandId: supplier.brandId,
          entityType: 'supplier',
          entityId: id,
          metadata: { lines: input.prices.length },
        },
        meta,
      );
      return describe(db, supplier);
    },
  };
}

export type SuppliersService = ReturnType<typeof createSuppliersService>;
