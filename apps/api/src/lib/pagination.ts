import type { Page } from '@pos/shared';

// Prisma arguments for one cursor page. It reads one extra row to learn whether more follow.
export function cursorPageArgs(limit: number, cursor: string | undefined) {
  return {
    take: limit + 1,
    orderBy: { id: 'asc' as const },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  };
}

// Turns the rows read with cursorPageArgs into a page, with the cursor for the next one.
export function toPage<Row extends { id: string }, Item>(
  rows: Row[],
  limit: number,
  toItem: (row: Row) => Item,
): Page<Item> {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    data: pageRows.map(toItem),
    nextCursor: hasMore ? (pageRows.at(-1)?.id ?? null) : null,
  };
}
