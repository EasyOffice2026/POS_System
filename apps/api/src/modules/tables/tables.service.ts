import {
  type DiningTable,
  type FloorTable,
  type PutTablesRequest,
  tableNameKey,
} from '@pos/shared';
import type { DiningTable as TableRow } from '../../generated/prisma/client';
import { type AuditEvent, writeAudit } from '../../lib/audit';
import { errors } from '../../lib/http-errors';
import type { PrismaClient } from '../../lib/prisma';
import type { RequestMeta } from '../../lib/request-meta';
import type { ActorContext } from '../../middleware/authenticate';
import type { ScopedClient } from '../../tenancy/scoped-client';

export interface TablesDeps {
  prisma: PrismaClient;
}

export function toTable(row: TableRow): DiningTable {
  return {
    id: row.id,
    branchId: row.branchId,
    name: row.name,
    area: row.area,
    seats: row.seats,
    shape: row.shape,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    isActive: row.isActive,
  };
}

// A name no table can have, for the moment two tables swap their names: "~" and the last nine
// characters of the id, which are random.
const parkedName = (id: string) => `~${id.slice(-9)}`;

// The tables of a branch and its floor plan. See docs/specs/023-floor-plan.md.
export function createTablesService({ prisma }: TablesDeps) {
  const audit = (event: AuditEvent, meta: RequestMeta) =>
    writeAudit(prisma, { ...event, ip: meta.ip, userAgent: meta.userAgent });

  // A branch the person cannot see is answered like one that does not exist.
  async function branchOf(db: ScopedClient, branchId: string) {
    const branch = await db.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw errors.notFound('Branch');
    return branch;
  }

  const tablesOf = (db: ScopedClient, branchId: string, onlyActive = false) =>
    db.diningTable.findMany({
      where: { branchId, ...(onlyActive ? { isActive: true } : {}) },
      orderBy: [{ area: 'asc' }, { position: 'asc' }, { id: 'asc' }],
    });

  return {
    async list({ db }: ActorContext, branchId: string): Promise<DiningTable[]> {
      await branchOf(db, branchId);
      return (await tablesOf(db, branchId)).map(toTable);
    },

    // The tables in use, each with its open order, for the POS (rule 8).
    async floor({ db }: ActorContext, branchId: string): Promise<FloorTable[]> {
      await branchOf(db, branchId);
      const tables = await tablesOf(db, branchId, true);
      const orders = await db.order.findMany({
        where: { branchId, status: 'open', tableOpenKey: { not: null } },
        select: {
          id: true,
          number: true,
          total: true,
          createdAt: true,
          billPrintedAt: true,
          tableId: true,
        },
      });
      const orderAt = new Map(orders.map((order) => [order.tableId, order]));
      return tables.map((table) => {
        const order = orderAt.get(table.id);
        return {
          ...toTable(table),
          order: order
            ? {
                id: order.id,
                number: order.number,
                total: order.total.toFixed(3),
                openedAt: order.createdAt.toISOString(),
                billPrintedAt: order.billPrintedAt ? order.billPrintedAt.toISOString() : null,
              }
            : null,
        };
      });
    },

    // Saves the whole plan: tables kept, changed, added and left out (rules 1 and 2).
    async save(
      ctx: ActorContext,
      branchId: string,
      input: PutTablesRequest,
      meta: RequestMeta,
    ): Promise<DiningTable[]> {
      const { auth, db } = ctx;
      const branch = await branchOf(db, branchId);
      const existing = await tablesOf(db, branchId);
      const byId = new Map(existing.map((table) => [table.id, table]));

      const unknown = input.tables.findIndex((table) => table.id && !byId.has(table.id));
      if (unknown >= 0) {
        throw errors.validation([{ path: `tables.${unknown}.id`, message: 'TABLE_NOT_FOUND' }]);
      }

      const kept = new Set(input.tables.flatMap((table) => (table.id ? [table.id] : [])));
      const leftOut = existing.filter((table) => !kept.has(table.id));
      const outOfUse = new Set([
        ...leftOut.map((table) => table.id),
        ...input.tables.flatMap((table) => (table.id && !table.isActive ? [table.id] : [])),
      ]);
      // A table with an open order stays in use.
      const busy = await db.order.count({
        where: { branchId, status: 'open', tableOpenKey: { in: [...outOfUse] } },
      });
      if (busy > 0) {
        throw errors.conflict('TABLE_IN_USE', 'A table with an open order must stay in use');
      }

      // A table left out that ever had an order is kept out of use, with its name.
      const used = new Set(
        leftOut.length === 0
          ? []
          : (
              await db.order.findMany({
                where: { tableId: { in: leftOut.map((table) => table.id) } },
                select: { tableId: true },
                distinct: ['tableId'],
              })
            ).flatMap((order) => (order.tableId ? [order.tableId] : [])),
      );
      const keptNames = new Map(
        leftOut.filter((table) => used.has(table.id)).map((table) => [table.nameKey, table]),
      );
      const clash = input.tables.findIndex((table) => keptNames.has(tableNameKey(table.name)));
      if (clash >= 0) {
        throw errors.validation([{ path: `tables.${clash}.name`, message: 'TABLE_NAME_TAKEN' }]);
      }

      await db.$transaction(async (tx) => {
        await tx.diningTable.deleteMany({
          where: { id: { in: leftOut.filter((table) => !used.has(table.id)).map((t) => t.id) } },
        });
        if (used.size > 0) {
          await tx.diningTable.updateMany({
            where: { id: { in: [...used] } },
            data: { isActive: false },
          });
        }
        // Names that change are parked first, so two tables can swap theirs.
        for (const table of input.tables) {
          const before = table.id ? byId.get(table.id) : undefined;
          if (before && before.nameKey !== tableNameKey(table.name)) {
            const parked = parkedName(before.id);
            await tx.diningTable.update({
              where: { id: before.id },
              data: { name: parked, nameKey: parked },
            });
          }
        }
        for (const [position, table] of input.tables.entries()) {
          const data = {
            name: table.name,
            nameKey: tableNameKey(table.name),
            area: table.area,
            seats: table.seats,
            shape: table.shape,
            x: table.x,
            y: table.y,
            width: table.width,
            height: table.height,
            isActive: table.isActive,
            position,
          };
          if (table.id) {
            await tx.diningTable.update({ where: { id: table.id }, data });
          } else {
            await tx.diningTable.create({
              data: { ...data, brandId: branch.brandId, branchId },
            });
          }
        }
      });

      const saved = await tablesOf(db, branchId);
      await audit(
        {
          action: 'branch.tables_updated',
          userId: auth.sub,
          brandId: branch.brandId,
          branchId,
          entityType: 'branch',
          entityId: branchId,
          metadata: {
            tables: saved.length,
            inUse: saved.filter((table) => table.isActive).length,
            removed: leftOut.length - used.size,
          },
        },
        meta,
      );
      return saved.map(toTable);
    },
  };
}

export type TablesService = ReturnType<typeof createTablesService>;
