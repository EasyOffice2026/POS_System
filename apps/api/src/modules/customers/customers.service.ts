import {
  type AdjustPointsRequest,
  type Customer,
  type CustomerDetail,
  type CustomerListQuery,
  customerSearchText,
  normalizeSearchText,
  type Page,
  type UpdateCustomerRequest,
} from '@pos/shared';
import type { Customer as CustomerRow, Prisma } from '../../generated/prisma/client';
import { type AuditEvent, writeAudit } from '../../lib/audit';
import { errors } from '../../lib/http-errors';
import { splitPage } from '../../lib/pagination';
import type { PrismaClient } from '../../lib/prisma';
import type { RequestMeta } from '../../lib/request-meta';
import type { ActorContext } from '../../middleware/authenticate';
import type { ScopedClient } from '../../tenancy/scoped-client';

export interface CustomersDeps {
  prisma: PrismaClient;
  now: () => Date;
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (character) => `\\${character}`);

export function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    brandId: row.brandId,
    phone: row.phone,
    name: row.name,
    email: row.email,
    notes: row.notes,
    points: row.points,
    visits: row.visits,
    totalSpent: row.totalSpent.toFixed(3),
    lastVisitAt: row.lastVisitAt ? row.lastVisitAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

// The customers of a brand and their points. See docs/specs/022-loyalty.md.
export function createCustomersService({ prisma, now }: CustomersDeps) {
  const audit = (event: AuditEvent, meta: RequestMeta) =>
    writeAudit(prisma, { ...event, ip: meta.ip, userAgent: meta.userAgent });

  const nameOf = async (userId: string) =>
    (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? null;

  // A customer the person cannot see is answered like one that does not exist.
  async function loadCustomer(db: ScopedClient, id: string): Promise<CustomerRow> {
    const row = await db.customer.findUnique({ where: { id } });
    if (!row) throw errors.notFound('Customer');
    return row;
  }

  async function describe(db: ScopedClient, row: CustomerRow): Promise<CustomerDetail> {
    const entries = await db.loyaltyEntry.findMany({
      where: { customerId: row.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    const orderIds = [
      ...new Set(entries.flatMap((entry) => (entry.orderId ? [entry.orderId] : []))),
    ];
    const orders =
      orderIds.length === 0
        ? []
        : await db.order.findMany({
            where: { id: { in: orderIds } },
            select: { id: true, number: true },
          });
    const numberOf = new Map(orders.map((order) => [order.id, order.number]));
    return {
      ...toCustomer(row),
      entries: entries.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        points: entry.points,
        balanceAfter: entry.balanceAfter,
        orderId: entry.orderId,
        orderNumber: entry.orderId ? (numberOf.get(entry.orderId) ?? null) : null,
        note: entry.note,
        byName: entry.byName,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }

  return {
    // The brand's customers, the latest visits first, by phone or name.
    async list({ db }: ActorContext, query: CustomerListQuery): Promise<Page<Customer>> {
      const filters: Prisma.CustomerWhereInput[] = query.brandId
        ? [{ brandId: query.brandId }]
        : [];
      for (const word of normalizeSearchText(query.q ?? '').split(' ')) {
        if (word) filters.push({ searchText: { contains: escapeLike(word) } });
      }
      const rows = await db.customer.findMany({
        where: { AND: filters },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        orderBy: [{ lastVisitAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      });
      const page = splitPage(rows, query.limit);
      return { data: page.rows.map(toCustomer), nextCursor: page.nextCursor };
    },

    // One customer by phone, for the POS.
    async lookup({ db }: ActorContext, phone: string): Promise<Customer> {
      const row = await db.customer.findFirst({ where: { phone } });
      if (!row) throw errors.notFound('Customer');
      return toCustomer(row);
    },

    async get({ db }: ActorContext, id: string): Promise<CustomerDetail> {
      return describe(db, await loadCustomer(db, id));
    },

    async update(
      ctx: ActorContext,
      id: string,
      input: UpdateCustomerRequest,
      meta: RequestMeta,
    ): Promise<CustomerDetail> {
      const { auth, db } = ctx;
      const target = await loadCustomer(db, id);
      const changed = (['name', 'email', 'notes'] as const).filter(
        (key) => input[key] !== undefined && input[key] !== target[key],
      );
      if (changed.length === 0) return describe(db, target);
      const name = input.name === undefined ? target.name : input.name;
      const row = await db.customer.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.email === undefined ? {} : { email: input.email }),
          ...(input.notes === undefined ? {} : { notes: input.notes }),
          searchText: customerSearchText(target.phone, name),
        },
      });
      await audit(
        {
          action: 'customer.updated',
          userId: auth.sub,
          brandId: target.brandId,
          entityType: 'customer',
          entityId: id,
          metadata: { changed: [...changed] },
        },
        meta,
      );
      return describe(db, row);
    },

    // Points given (positive) or taken by hand; the balance never goes below zero (rule 5).
    async adjustPoints(
      ctx: ActorContext,
      id: string,
      input: AdjustPointsRequest,
      meta: RequestMeta,
    ): Promise<CustomerDetail> {
      const { auth, db } = ctx;
      const target = await loadCustomer(db, id);
      const byName = await nameOf(auth.sub);
      const row = await db.$transaction(async (tx) => {
        const current = await tx.customer.findUnique({ where: { id } });
        const balance = (current?.points ?? 0) + input.points;
        if (balance < 0) {
          throw errors.validation([{ path: 'points', message: 'POINTS_NOT_ENOUGH' }]);
        }
        await tx.loyaltyEntry.create({
          data: {
            brandId: target.brandId,
            customerId: id,
            kind: 'adjust',
            points: input.points,
            balanceAfter: balance,
            note: input.reason,
            byId: auth.sub,
            byName,
            createdAt: now(),
          },
        });
        return tx.customer.update({ where: { id }, data: { points: balance } });
      });
      await audit(
        {
          action: 'customer.points_adjusted',
          userId: auth.sub,
          brandId: target.brandId,
          entityType: 'customer',
          entityId: id,
          metadata: { points: input.points, reason: input.reason, balance: row.points },
        },
        meta,
      );
      return describe(db, row);
    },
  };
}

export type CustomersService = ReturnType<typeof createCustomersService>;
