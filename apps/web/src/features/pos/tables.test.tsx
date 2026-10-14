import type { FloorTable, Order } from '@pos/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  brandSettings,
  fullCashier,
  ids,
  page,
  pizzaBrand,
  pizzaMall,
  sessionFor,
  shiftSummary,
} from '../../test/fixtures';
import { branchMenu } from '../../test/menu-fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { lineIds, order, orderIds, orderLine, orderSummary } from '../../test/order-fixtures';
import { renderApp } from '../../test/render-app';
import { forgetTerminal, saveTerminal } from './terminal-store';

type Uuid = ReturnType<typeof crypto.randomUUID>;

const FLOOR = `GET /api/v1/branches/${ids.pizzaMall}/floor`;
const CREATE = 'POST /api/v1/orders';
const LINES = `POST /api/v1/orders/${orderIds.first}/lines`;
const TABLE = `PUT /api/v1/orders/${orderIds.first}/table`;
const BILL = `POST /api/v1/orders/${orderIds.first}/bill`;

afterEach(() => {
  forgetTerminal();
});

const tableIds = {
  one: '01990000-0000-7000-8000-00000000e001',
  two: '01990000-0000-7000-8000-00000000e002',
  three: '01990000-0000-7000-8000-00000000e003',
  seven: '01990000-0000-7000-8000-00000000e007',
};

const floorTable = (overrides: Partial<FloorTable>): FloorTable => ({
  id: tableIds.one,
  branchId: ids.pizzaMall,
  name: '1',
  area: 'Inside',
  seats: 4,
  shape: 'square',
  x: 0,
  y: 0,
  width: 2,
  height: 2,
  isActive: true,
  order: null,
  ...overrides,
});

const floor = [
  floorTable({}),
  floorTable({
    id: tableIds.two,
    name: '2',
    x: 3,
    order: {
      id: orderIds.second,
      number: 3,
      total: '12.000',
      openedAt: '2026-10-13T09:00:00.000Z',
      billPrintedAt: null,
    },
  }),
  floorTable({
    id: tableIds.three,
    name: '3',
    x: 6,
    order: {
      id: '01990000-0000-7000-8000-000000000703',
      number: 4,
      total: '8.000',
      openedAt: '2026-10-13T09:10:00.000Z',
      billPrintedAt: '2026-10-13T09:40:00.000Z',
    },
  }),
  floorTable({ id: tableIds.seven, name: '7', area: 'Terrace', shape: 'round' }),
];

const atOne = { id: tableIds.one, name: '1', area: 'Inside' };
const colaAtOne = order({
  type: 'dine_in',
  table: atOne,
  lines: [orderLine()],
  subtotal: '5.000',
  total: '5.000',
});

let current: Order = colaAtOne;

function posApi(handlers: Record<string, MockHandler> = {}) {
  current = colaAtOne;
  saveTerminal({
    branchId: ids.pizzaMall,
    brandId: ids.pizza,
    branchName: pizzaMall.name,
    brandName: pizzaBrand.name,
  });
  const remembered = Object.fromEntries(
    Object.entries(handlers).map(([key, handler]) => [
      key,
      async (request: Parameters<MockHandler>[0]) => {
        const response = await handler(request);
        if (response.ok && key !== FLOOR) current = (await response.clone().json()) as Order;
        return response;
      },
    ]),
  );
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(fullCashier)),
    'GET /api/v1/menu': () => json(branchMenu()),
    [`GET /api/v1/brands/${ids.pizza}/settings`]: () => json(brandSettings()),
    'GET /api/v1/shifts/current': () => json(shiftSummary()),
    'GET /api/v1/orders': () => json(page([orderSummary(current)])),
    [`GET /api/v1/orders/${orderIds.first}`]: () => json(current),
    [`GET /api/v1/orders/${orderIds.second}`]: () =>
      json(
        order({
          id: orderIds.second,
          number: 3,
          type: 'dine_in',
          table: { ...atOne, id: tableIds.two, name: '2' },
        }),
      ),
    [FLOOR]: () => json({ data: floor }),
    ...remembered,
  });
}

type User = ReturnType<typeof userEvent.setup>;

async function openTables(user: User) {
  await user.click(await screen.findByRole('button', { name: 'Tables' }));
  return screen.findByRole('dialog', { name: 'Tables' });
}

describe('tables on the POS', () => {
  it('shows the floor, and starts a dine-in order at a free table', async () => {
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce(orderIds.first as Uuid)
      .mockReturnValueOnce(lineIds.cola as Uuid);
    const api = posApi({
      [CREATE]: () => json(order({ type: 'dine_in', table: atOne }), 201),
      [LINES]: () => json(colaAtOne),
    });
    const user = userEvent.setup();
    renderApp('/pos');

    const dialog = await openTables(user);
    const inside = await within(dialog).findByRole('group', { name: 'Inside' });
    expect(
      within(inside)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Table 1, Free, 4 seats',
      'Table 2, Order 3, 12.000 KWD',
      'Table 3, Order 4, 8.000 KWD, Bill printed',
    ]);
    await user.click(within(dialog).getByRole('button', { name: 'Terrace' }));
    expect(within(dialog).getByRole('group', { name: 'Terrace' })).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Inside' }));
    await user.click(within(dialog).getByRole('button', { name: /^Table 1,/ }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const panel = screen.getByRole('region', { name: 'Order' });
    expect(within(panel).getByTestId('order-table')).toHaveTextContent('Table 1');
    expect(within(panel).getByRole('button', { name: 'Dine-in' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('tab', { name: 'Drinks' }));
    await user.click(screen.getByRole('button', { name: /Cola/ }));
    await within(panel).findByText('Cola');
    expect(api.calls.find((call) => call.key === CREATE)?.body).toEqual({
      id: orderIds.first,
      branchId: ids.pizzaMall,
      type: 'dine_in',
      tableId: tableIds.one,
    });
    expect(within(panel).getByTestId('order-table')).toHaveTextContent('Table 1');
  });

  it('opens the order of a taken table', async () => {
    posApi();
    const user = userEvent.setup();
    renderApp('/pos');

    const dialog = await openTables(user);
    await user.click(await within(dialog).findByRole('button', { name: /^Table 2,/ }));
    const panel = screen.getByRole('region', { name: 'Order' });
    expect(await within(panel).findByRole('heading', { name: 'Order 3' })).toBeVisible();
    expect(within(panel).getByTestId('order-table')).toHaveTextContent('Table 2');
  });

  it('moves the order to a free table, and prints its bill', async () => {
    const api = posApi({
      [TABLE]: ({ body }) =>
        (body as { tableId: string }).tableId === tableIds.seven
          ? json({ ...current, table: { id: tableIds.seven, name: '7', area: 'Terrace' } })
          : errorResponse(409, 'TABLE_TAKEN'),
      [BILL]: () => json({ ...current, billPrintedAt: '2026-10-13T09:45:00.000Z' }),
    });
    const user = userEvent.setup();
    renderApp('/pos');

    await user.click(await screen.findByRole('button', { name: 'Open orders' }));
    await user.click(await screen.findByRole('button', { name: /Order 1/ }));
    const panel = screen.getByRole('region', { name: 'Order' });
    await within(panel).findByTestId('order-table');

    await user.click(within(panel).getByRole('button', { name: 'Change' }));
    const move = await screen.findByRole('dialog', { name: 'Move to a table' });
    const inside = await within(move).findByRole('group', { name: 'Inside' });
    expect(within(inside).getByRole('button', { name: /^Table 1,/ })).toBeDisabled();
    expect(within(inside).getByRole('button', { name: /^Table 2,/ })).toBeDisabled();
    await user.click(within(move).getByRole('button', { name: 'Terrace' }));
    await user.click(within(move).getByRole('button', { name: /^Table 7,/ }));

    expect(await within(panel).findByText('Terrace')).toBeVisible();
    expect(within(panel).getByTestId('order-table')).toHaveTextContent('Table 7');
    expect(api.calls.find((call) => call.key === TABLE)?.body).toEqual({ tableId: tableIds.seven });

    await user.click(within(panel).getByRole('button', { name: 'Print bill' }));
    const bill = await screen.findByRole('dialog', { name: 'Bill' });
    const receipt = within(bill).getByTestId('receipt');
    expect(receipt).toHaveTextContent('Dine-in · Table 7');
    expect(receipt).toHaveTextContent('Not paid');
    expect(receipt).toHaveTextContent('Total5.000 KWD');
    expect(api.count(BILL)).toBe(1);
    await user.click(within(bill).getByRole('button', { name: 'Back' }));
    expect(within(panel).getByText('Bill printed')).toBeVisible();
  });
});
