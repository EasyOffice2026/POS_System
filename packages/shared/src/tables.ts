import { z } from 'zod';

// The tables of a branch, drawn on a floor plan. See docs/specs/023-floor-plan.md.

// Each area of a branch is a grid of this many columns and rows (rule 1).
export const FLOOR_COLUMNS = 24;
export const FLOOR_ROWS = 16;
export const MAX_TABLE_SIZE = 4;
export const MAX_TABLES = 200;
export const MAX_TABLE_SEATS = 50;

export const tableShapes = ['square', 'round'] as const;
export const tableShapeSchema = z.enum(tableShapes, { error: 'TABLE_SHAPE_INVALID' });
export type TableShape = z.infer<typeof tableShapeSchema>;

// The key that makes a name unique in its branch, whatever the capitals and spaces.
export const tableNameKey = (name: string): string =>
  name.trim().replace(/\s+/g, ' ').toLowerCase();

// ---------------------------------------------------------------------------------------------
// The geometry, the same for the API and the editor

export interface TablePlace {
  area: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const isInsideFloor = (table: TablePlace): boolean =>
  table.x >= 0 &&
  table.y >= 0 &&
  table.x + table.width <= FLOOR_COLUMNS &&
  table.y + table.height <= FLOOR_ROWS;

// Two tables of the same area that share at least one cell.
export const tablesOverlap = (a: TablePlace, b: TablePlace): boolean =>
  a.area.trim().toLowerCase() === b.area.trim().toLowerCase() &&
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

// The first place of an area, from the top left, where a table of this size fits among the
// others; null when the area is full.
export function freePlace(
  others: readonly TablePlace[],
  area: string,
  width = 1,
  height = 1,
): { x: number; y: number } | null {
  for (let y = 0; y + height <= FLOOR_ROWS; y += 1) {
    for (let x = 0; x + width <= FLOOR_COLUMNS; x += 1) {
      const place = { area, x, y, width, height };
      if (!others.some((other) => tablesOverlap(place, other))) return { x, y };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// What the API answers

export const diningTableSchema = z.object({
  id: z.uuid(),
  branchId: z.uuid(),
  name: z.string(),
  area: z.string(),
  seats: z.number().int(),
  shape: tableShapeSchema,
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
  isActive: z.boolean(),
});
export type DiningTable = z.infer<typeof diningTableSchema>;

export const diningTableListSchema = z.object({ data: z.array(diningTableSchema) });

// The open order at a table, as the POS floor shows it (rule 8).
export const tableOrderSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  total: z.string(),
  openedAt: z.iso.datetime(),
  billPrintedAt: z.iso.datetime().nullable(),
});
export type TableOrder = z.infer<typeof tableOrderSchema>;

export const floorTableSchema = diningTableSchema.extend({ order: tableOrderSchema.nullable() });
export type FloorTable = z.infer<typeof floorTableSchema>;

export const floorSchema = z.object({ data: z.array(floorTableSchema) });

// The table as an order shows it.
export const orderTableSchema = z.object({ id: z.uuid(), name: z.string(), area: z.string() });
export type OrderTable = z.infer<typeof orderTableSchema>;

// ---------------------------------------------------------------------------------------------
// Requests

const cellSchema = (max: number) =>
  z
    .number({ error: 'TABLE_OUTSIDE' })
    .int('TABLE_OUTSIDE')
    .min(0, 'TABLE_OUTSIDE')
    .max(max - 1, 'TABLE_OUTSIDE');

const sizeSchema = z
  .number({ error: 'TABLE_SIZE_INVALID' })
  .int('TABLE_SIZE_INVALID')
  .min(1, 'TABLE_SIZE_INVALID')
  .max(MAX_TABLE_SIZE, 'TABLE_SIZE_INVALID');

export const tableRequestSchema = z.strictObject({
  // A table that is kept has its id; a new one has none.
  id: z.uuid().optional(),
  name: z
    .string({ error: 'TABLE_NAME_REQUIRED' })
    .trim()
    .min(1, 'TABLE_NAME_REQUIRED')
    .max(10, 'TABLE_NAME_TOO_LONG')
    .transform((text) => text.replace(/\s+/g, ' ')),
  area: z
    .string({ error: 'AREA_REQUIRED' })
    .trim()
    .min(1, 'AREA_REQUIRED')
    .max(40, 'AREA_TOO_LONG')
    .transform((text) => text.replace(/\s+/g, ' ')),
  seats: z
    .number({ error: 'SEATS_INVALID' })
    .int('SEATS_INVALID')
    .min(1, 'SEATS_INVALID')
    .max(MAX_TABLE_SEATS, 'SEATS_INVALID'),
  shape: tableShapeSchema,
  x: cellSchema(FLOOR_COLUMNS),
  y: cellSchema(FLOOR_ROWS),
  width: sizeSchema,
  height: sizeSchema,
  isActive: z.boolean(),
});
export type TableRequest = z.infer<typeof tableRequestSchema>;

// The whole plan of a branch, checked as a whole: names, places and overlaps (rules 1 and 2).
export const putTablesRequestSchema = z
  .strictObject({
    tables: z.array(tableRequestSchema).max(MAX_TABLES, 'TABLES_TOO_MANY'),
  })
  .superRefine(({ tables }, ctx) => {
    const names = new Map<string, number>();
    const ids = new Set<string>();
    tables.forEach((table, index) => {
      if (table.id) {
        if (ids.has(table.id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['tables', index, 'id'],
            message: 'TABLE_REPEATED',
          });
        }
        ids.add(table.id);
      }
      const key = tableNameKey(table.name);
      if (names.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['tables', index, 'name'],
          message: 'TABLE_NAME_TAKEN',
        });
      } else {
        names.set(key, index);
      }
      if (!isInsideFloor(table)) {
        ctx.addIssue({ code: 'custom', path: ['tables', index, 'x'], message: 'TABLE_OUTSIDE' });
        return;
      }
      if (!table.isActive) return;
      const before = tables
        .slice(0, index)
        .some((other) => other.isActive && isInsideFloor(other) && tablesOverlap(table, other));
      if (before) {
        ctx.addIssue({ code: 'custom', path: ['tables', index], message: 'TABLE_OVERLAP' });
      }
    });
  });
export type PutTablesRequest = z.infer<typeof putTablesRequestSchema>;

export const putOrderTableRequestSchema = z.strictObject({
  tableId: z.uuid({ error: 'TABLE_NOT_FOUND' }),
});
export type PutOrderTableRequest = z.infer<typeof putOrderTableRequestSchema>;
