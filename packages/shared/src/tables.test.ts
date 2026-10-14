import { describe, expect, it } from 'vitest';
import {
  FLOOR_COLUMNS,
  freePlace,
  putTablesRequestSchema,
  type TableRequest,
  tableNameKey,
  tablesOverlap,
} from './tables';

const table = (overrides: Partial<Record<keyof TableRequest, unknown>> = {}) => ({
  name: '1',
  area: 'Inside',
  seats: 4,
  shape: 'square' as const,
  x: 0,
  y: 0,
  width: 2,
  height: 2,
  isActive: true,
  ...overrides,
});

const problems = (tables: unknown[]) => {
  const result = putTablesRequestSchema.safeParse({ tables });
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

describe('the floor plan of a branch', () => {
  it('takes tables in two areas, side by side, with tidy names', () => {
    const result = putTablesRequestSchema.parse({
      tables: [
        table({ name: ' 1 ' }),
        table({ name: '2', x: 2 }),
        table({ name: 'Bar   7', area: ' Terrace ', x: 0 }),
      ],
    });
    expect(result.tables.map((row) => [row.name, row.area])).toEqual([
      ['1', 'Inside'],
      ['2', 'Inside'],
      ['Bar 7', 'Terrace'],
    ]);
  });

  it('refuses overlaps in one area, tables outside the grid and names used twice', () => {
    expect(
      problems([
        table(),
        table({ name: '2', x: 1, y: 1 }),
        table({ name: 't1', x: FLOOR_COLUMNS - 1 }),
        table({ name: 'T1', area: 'Terrace' }),
      ]),
    ).toEqual([
      'tables.1: TABLE_OVERLAP',
      'tables.2.x: TABLE_OUTSIDE',
      'tables.3.name: TABLE_NAME_TAKEN',
    ]);
  });

  it('lets a table out of use share its place, and checks each field', () => {
    expect(problems([table(), table({ name: '2', isActive: false })])).toEqual([]);
    expect(
      problems([table({ name: '', area: '', seats: 0, shape: 'oval', width: 5, y: -1 })]),
    ).toEqual([
      'tables.0.name: TABLE_NAME_REQUIRED',
      'tables.0.area: AREA_REQUIRED',
      'tables.0.seats: SEATS_INVALID',
      'tables.0.shape: TABLE_SHAPE_INVALID',
      'tables.0.y: TABLE_OUTSIDE',
      'tables.0.width: TABLE_SIZE_INVALID',
    ]);
    expect(problems([table({ name: '12345678901' })])).toEqual([
      'tables.0.name: TABLE_NAME_TOO_LONG',
    ]);
  });

  it('refuses the same table twice and more than 200 tables', () => {
    const id = '01990000-0000-7000-8000-00000000d001';
    expect(problems([table({ id }), table({ id, name: '2', x: 4 })])).toEqual([
      'tables.1.id: TABLE_REPEATED',
    ]);
    const many = Array.from({ length: 201 }, (_, index) =>
      table({ name: String(index), isActive: false }),
    );
    expect(problems(many)).toEqual(['tables: TABLES_TOO_MANY']);
  });
});

describe('the geometry of tables', () => {
  it('sees an overlap only in the same area', () => {
    const a = { area: 'Inside', x: 0, y: 0, width: 2, height: 2 };
    expect(tablesOverlap(a, { ...a, x: 1, y: 1 })).toBe(true);
    expect(tablesOverlap(a, { ...a, x: 2 })).toBe(false);
    expect(tablesOverlap(a, { ...a, area: 'inside ' })).toBe(true);
    expect(tablesOverlap(a, { ...a, area: 'Terrace' })).toBe(false);
  });

  it('finds the first free place from the top left', () => {
    const taken = [{ area: 'Inside', x: 0, y: 0, width: 2, height: 1 }];
    expect(freePlace(taken, 'Inside')).toEqual({ x: 2, y: 0 });
    expect(freePlace(taken, 'Terrace', 2, 2)).toEqual({ x: 0, y: 0 });
    const full = [{ area: 'Inside', x: 0, y: 0, width: FLOOR_COLUMNS, height: 16 }];
    expect(freePlace(full, 'Inside')).toBeNull();
  });

  it('makes one key of names that differ in capitals and spaces', () => {
    expect(tableNameKey(' Bar  7 ')).toBe(tableNameKey('bar 7'));
  });
});
