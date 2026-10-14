import { FLOOR_COLUMNS, FLOOR_ROWS, type TableShape } from '@pos/shared';
import type { MouseEvent, ReactNode } from 'react';

export interface PlacedTable {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shape: TableShape;
}

interface FloorGridProps<T extends PlacedTable> {
  label: string;
  tables: readonly T[];
  // The table itself, a button that fills its place.
  renderTable: (table: T) => ReactNode;
  // A tap on an empty spot, with the cell it hit.
  onEmpty?: (cell: { x: number; y: number }) => void;
}

const percent = (part: number, whole: number) => `${(part / whole) * 100}%`;

// One area of a floor plan: a grid of 24 by 16 cells, drawn to the width it is given, with the
// tables on it. It is laid out left to right in both languages, like a drawing.
// See docs/specs/023-floor-plan.md.
export function FloorGrid<T extends PlacedTable>({
  label,
  tables,
  renderTable,
  onEmpty,
}: FloorGridProps<T>) {
  function onClick(event: MouseEvent<HTMLDivElement>) {
    if (!onEmpty || event.target !== event.currentTarget) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const x = Math.floor(((event.clientX - box.left) / box.width) * FLOOR_COLUMNS);
    const y = Math.floor(((event.clientY - box.top) / box.height) * FLOOR_ROWS);
    onEmpty({
      x: Math.min(Math.max(x, 0), FLOOR_COLUMNS - 1),
      y: Math.min(Math.max(y, 0), FLOOR_ROWS - 1),
    });
  }

  return (
    // Only a pointer places a table on an empty spot; the keyboard moves it with the arrow keys.
    <div
      role="group"
      aria-label={label}
      dir="ltr"
      onClick={onClick}
      className="relative w-full rounded-md border border-slate-300 bg-slate-50"
      style={{
        aspectRatio: `${FLOOR_COLUMNS} / ${FLOOR_ROWS}`,
        backgroundImage:
          'linear-gradient(to right, rgb(226 232 240) 1px, transparent 1px), linear-gradient(to bottom, rgb(226 232 240) 1px, transparent 1px)',
        backgroundSize: `${percent(1, FLOOR_COLUMNS)} ${percent(1, FLOOR_ROWS)}`,
      }}
    >
      {tables.map((table) => (
        <div
          key={table.id}
          className="absolute p-0.5"
          style={{
            left: percent(table.x, FLOOR_COLUMNS),
            top: percent(table.y, FLOOR_ROWS),
            width: percent(table.width, FLOOR_COLUMNS),
            height: percent(table.height, FLOOR_ROWS),
          }}
        >
          {renderTable(table)}
        </div>
      ))}
    </div>
  );
}

// The look of a table's button: its shape, and the colours the caller gives.
export const tableButtonClass = (shape: TableShape, colours: string) =>
  `flex h-full w-full flex-col items-center justify-center overflow-hidden border-2 text-center text-xs leading-tight font-semibold focus:ring-2 focus:ring-slate-500 focus:ring-offset-1 focus:outline-none ${
    shape === 'round' ? 'rounded-full' : 'rounded-md'
  } ${colours}`;
