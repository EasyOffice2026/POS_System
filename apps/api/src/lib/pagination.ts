import type { Page } from '@pos/shared';

// Prisma arguments for one cursor page. It reads one extra row to learn whether more follow.
// Sorted by id unless the caller adds its own orderBy (end it with id so the order is stable).
export function cursorPageArgs(limit: number, cursor: string | undefined) {
  return {
    take: limit + 1,
    orderBy: { id: 'asc' as const },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  };
}

// Cuts the rows read with cursorPageArgs down to one page and finds the cursor for the next.
export function splitPage<Row extends { id: string }>(rows: Row[], limit: number) {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  return { rows: pageRows, nextCursor: hasMore ? (pageRows.at(-1)?.id ?? null) : null };
}

// Turns the rows read with cursorPageArgs into a page, with the cursor for the next one.
export function toPage<Row extends { id: string }, Item>(
  rows: Row[],
  limit: number,
  toItem: (row: Row) => Item,
): Page<Item> {
  const page = splitPage(rows, limit);
  return { data: page.rows.map(toItem), nextCursor: page.nextCursor };
}
