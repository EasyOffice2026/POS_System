import {
  type DiningTable,
  FLOOR_COLUMNS,
  FLOOR_ROWS,
  freePlace,
  MAX_TABLE_SIZE,
  MAX_TABLES,
  type PutTablesRequest,
  putTablesRequestSchema,
  tableNameKey,
  type TableShape,
  tableShapes,
} from '@pos/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FloorGrid, tableButtonClass } from '../../components/FloorGrid';
import {
  compactFieldClass,
  fieldClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../components/form';
import { fieldsFromIssues, messageFor, problemsFrom } from '../../lib/error-messages';
import { normalizeNumberInput } from '../../lib/numbers';
import { listTables, saveTables, tableKeys } from './tables-api';

interface Row {
  // The id of a saved table, or one made here for a new table.
  key: string;
  id?: string;
  name: string;
  area: string;
  seats: string;
  shape: TableShape;
  x: number;
  y: number;
  width: number;
  height: number;
  isActive: boolean;
}

const toRow = (table: DiningTable): Row => ({
  key: table.id,
  id: table.id,
  name: table.name,
  area: table.area,
  seats: String(table.seats),
  shape: table.shape,
  x: table.x,
  y: table.y,
  width: table.width,
  height: table.height,
  isActive: table.isActive,
});

const wholeNumber = (text: string) => {
  const typed = normalizeNumberInput(text).trim();
  return /^\d+$/.test(typed) ? Number(typed) : Number.NaN;
};

const toRequest = (rows: Row[]): PutTablesRequest => ({
  tables: rows.map(({ key: _key, id, seats, ...row }) => ({
    ...(id ? { id } : {}),
    ...row,
    seats: wholeNumber(seats),
  })),
});

const sizes = Array.from({ length: MAX_TABLE_SIZE }, (_, index) => index + 1);

// The floor plan of a branch: its areas, and the tables on each area's grid. A table is picked,
// then placed by tapping an empty spot or with the arrow keys. See docs/specs/023-floor-plan.md.
export function FloorPlanEditor({ branchId, readOnly }: { branchId: string; readOnly: boolean }) {
  const { t } = useTranslation();
  const tables = useQuery({
    queryKey: tableKeys.plan(branchId),
    queryFn: () => listTables(branchId),
  });

  if (tables.isPending) return <p className="text-sm text-slate-500">{t('common.loading')}</p>;
  if (tables.isError) {
    return (
      <p role="alert" className="text-sm text-red-700">
        {t('common.loadError')}
      </p>
    );
  }
  return <PlanForm branchId={branchId} saved={tables.data} readOnly={readOnly} />;
}

function PlanForm({
  branchId,
  saved,
  readOnly,
}: {
  branchId: string;
  saved: DiningTable[];
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>(() => saved.map(toRow));
  // Areas added here that have no table yet.
  const [newAreas, setNewAreas] = useState<string[]>([]);
  const areas = [...new Set([...rows.map((row) => row.area), ...newAreas])];
  const [picked, setPicked] = useState<string | null>(null);
  const area = picked && areas.includes(picked) ? picked : (areas[0] ?? t('tables.defaultArea'));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = rows.find((row) => row.key === selectedKey) ?? null;
  const [addingArea, setAddingArea] = useState(false);
  const [areaName, setAreaName] = useState('');
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const save = useMutation({
    mutationFn: (body: PutTablesRequest) => saveTables(branchId, body),
    onSuccess: (next) => {
      queryClient.setQueryData(tableKeys.plan(branchId), next);
      void queryClient.invalidateQueries({ queryKey: tableKeys.floor(branchId) });
      setRows(next.map(toRow));
      setNewAreas([]);
      setSelectedKey(null);
      setProblems({});
      setDone(true);
    },
    onError: (error) => {
      const found = problemsFrom(error);
      setProblems(found.fields);
      setFormProblem(found.form);
    },
  });

  const change = (key: string, next: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...next } : row)));
    setDone(false);
  };

  // Moves a table so that it stays on the grid.
  const place = (row: Row, x: number, y: number) =>
    change(row.key, {
      x: Math.min(Math.max(x, 0), FLOOR_COLUMNS - row.width),
      y: Math.min(Math.max(y, 0), FLOOR_ROWS - row.height),
    });

  function addTable() {
    const spot = freePlace(
      rows.filter((row) => row.isActive),
      area,
      2,
      2,
    ) ?? { x: 0, y: 0 };
    const taken = new Set(rows.map((row) => tableNameKey(row.name)));
    let number = 1;
    while (taken.has(String(number))) number += 1;
    const key = `new-${crypto.randomUUID()}`;
    setRows((current) => [
      ...current,
      {
        key,
        name: String(number),
        area,
        seats: '4',
        shape: 'square',
        ...spot,
        width: 2,
        height: 2,
        isActive: true,
      },
    ]);
    setSelectedKey(key);
    setDone(false);
  }

  function addArea() {
    const name = areaName.trim().replace(/\s+/g, ' ');
    if (!name) return;
    if (!areas.includes(name)) setNewAreas((current) => [...current, name]);
    setPicked(name);
    setSelectedKey(null);
    setAddingArea(false);
    setAreaName('');
  }

  function onSave() {
    setFormProblem(null);
    setDone(false);
    const body = toRequest(rows);
    const result = putTablesRequestSchema.safeParse(body);
    const found = result.success ? {} : fieldsFromIssues(result.error.issues);
    setProblems(found);
    if (Object.keys(found).length === 0) save.mutate(body);
  }

  function onArrow(event: KeyboardEvent, row: Row) {
    if (readOnly) return;
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const move = step[event.key];
    if (!move) return;
    event.preventDefault();
    place(row, row.x + move[0], row.y + move[1]);
  }

  // The problems, by table: "Table 3: ...".
  const listed = Object.entries(problems).map(([path, code]) => {
    const index = Number(path.split('.')[1]);
    const row = Number.isInteger(index) ? rows[index] : undefined;
    return {
      key: path,
      text: row
        ? `${t('pos.table.name', { name: row.name || '?' })}: ${messageFor(code, t)}`
        : messageFor(code, t),
    };
  });

  const field = (id: string, label: string, control: ReactNode) => (
    <label htmlFor={id} className="block text-sm font-medium text-slate-700">
      {label}
      {control}
    </label>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('tables.intro')}</p>

      <div className="flex flex-wrap items-center gap-2">
        {areas.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={name === area}
            onClick={() => {
              setPicked(name);
              setSelectedKey(null);
            }}
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              name === area ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            <bdi>{name}</bdi>
          </button>
        ))}
        {!readOnly &&
          (addingArea ? (
            <span className="flex flex-wrap items-center gap-2">
              <input
                aria-label={t('tables.areaName')}
                type="text"
                dir="auto"
                maxLength={40}
                value={areaName}
                onChange={(event) => setAreaName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addArea();
                  }
                }}
                className={compactFieldClass}
              />
              <button type="button" onClick={addArea} className={secondaryButtonClass}>
                {t('tables.addArea')}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setAddingArea(true)}
              className="text-sm text-slate-700 underline"
            >
              {t('tables.addArea')}
            </button>
          ))}
      </div>

      <FloorGrid
        label={area}
        tables={rows.filter((row) => row.area === area).map((row) => ({ ...row, id: row.key }))}
        onEmpty={
          readOnly || !selected || selected.area !== area
            ? undefined
            : (cell) => place(selected, cell.x, cell.y)
        }
        renderTable={(table) => {
          const row = rows.find((item) => item.key === table.id) as Row;
          const isSelected = row.key === selectedKey;
          const colours = isSelected
            ? 'border-slate-900 bg-slate-900 text-white'
            : row.isActive
              ? 'border-slate-500 bg-white text-slate-900 hover:bg-slate-100'
              : 'border-dashed border-slate-400 bg-slate-100 text-slate-500';
          return (
            <button
              type="button"
              aria-pressed={isSelected}
              aria-label={`${t('pos.table.name', { name: row.name })}, ${t('pos.table.seats', {
                count: wholeNumber(row.seats) || 0,
              })}${row.isActive ? '' : `, ${t('tables.outOfUse')}`}`}
              onClick={() => setSelectedKey(isSelected ? null : row.key)}
              onKeyDown={(event) => onArrow(event, row)}
              className={tableButtonClass(row.shape, colours)}
            >
              <span className="text-sm">{row.name}</span>
            </button>
          );
        }}
      />
      {!readOnly && (
        <p className="text-xs text-slate-500">
          {selected ? t('tables.placeHint') : t('tables.pickHint')}
        </p>
      )}

      {selected && (
        <fieldset
          className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
          disabled={readOnly}
        >
          <legend className="px-1 text-sm font-semibold">
            {t('pos.table.name', { name: selected.name || '?' })}
          </legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {field(
              'table-name',
              t('tables.name'),
              <input
                id="table-name"
                type="text"
                dir="auto"
                maxLength={10}
                value={selected.name}
                onChange={(event) => change(selected.key, { name: event.target.value })}
                className={fieldClass}
              />,
            )}
            {field(
              'table-seats',
              t('tables.seats'),
              <input
                id="table-seats"
                type="text"
                inputMode="numeric"
                dir="ltr"
                value={selected.seats}
                onChange={(event) => change(selected.key, { seats: event.target.value })}
                className={fieldClass}
              />,
            )}
            {field(
              'table-area',
              t('tables.area'),
              <select
                id="table-area"
                value={selected.area}
                onChange={(event) => {
                  change(selected.key, { area: event.target.value });
                  setPicked(event.target.value);
                }}
                className={fieldClass}
              >
                {areas.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>,
            )}
            {field(
              'table-shape',
              t('tables.shape'),
              <select
                id="table-shape"
                value={selected.shape}
                onChange={(event) =>
                  change(selected.key, { shape: event.target.value as TableShape })
                }
                className={fieldClass}
              >
                {tableShapes.map((shape) => (
                  <option key={shape} value={shape}>
                    {t(`tables.shapes.${shape}`)}
                  </option>
                ))}
              </select>,
            )}
            {field(
              'table-width',
              t('tables.width'),
              <select
                id="table-width"
                value={selected.width}
                onChange={(event) => change(selected.key, { width: Number(event.target.value) })}
                className={fieldClass}
              >
                {sizes.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>,
            )}
            {field(
              'table-height',
              t('tables.height'),
              <select
                id="table-height"
                value={selected.height}
                onChange={(event) => change(selected.key, { height: Number(event.target.value) })}
                className={fieldClass}
              >
                {sizes.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>,
            )}
            {field(
              'table-column',
              t('tables.column'),
              <input
                id="table-column"
                type="number"
                min={1}
                max={FLOOR_COLUMNS}
                dir="ltr"
                value={selected.x + 1}
                onChange={(event) => place(selected, Number(event.target.value) - 1, selected.y)}
                className={fieldClass}
              />,
            )}
            {field(
              'table-row',
              t('tables.row'),
              <input
                id="table-row"
                type="number"
                min={1}
                max={FLOOR_ROWS}
                dir="ltr"
                value={selected.y + 1}
                onChange={(event) => place(selected, selected.x, Number(event.target.value) - 1)}
                className={fieldClass}
              />,
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.isActive}
                onChange={(event) => change(selected.key, { isActive: event.target.checked })}
              />
              {t('tables.inUse')}
            </label>
            <button
              type="button"
              onClick={() => {
                setRows((current) => current.filter((row) => row.key !== selected.key));
                setSelectedKey(null);
                setDone(false);
              }}
              className="rounded-md px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              {t('tables.remove')}
            </button>
          </div>
        </fieldset>
      )}

      {listed.length > 0 && (
        <ul role="alert" className="space-y-1 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {listed.map((problem) => (
            <li key={problem.key}>{problem.text}</li>
          ))}
        </ul>
      )}
      {formProblem && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messageFor(formProblem, t)}
        </p>
      )}
      {done && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          {t('tables.saved')}
        </p>
      )}

      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={rows.length >= MAX_TABLES}
            onClick={addTable}
            className={secondaryButtonClass}
          >
            {t('tables.add')}
          </button>
          <button
            type="button"
            disabled={save.isPending}
            onClick={onSave}
            className={primaryButtonClass}
          >
            {save.isPending ? t('common.saving') : t('common.save')}
          </button>
        </div>
      )}
    </div>
  );
}
