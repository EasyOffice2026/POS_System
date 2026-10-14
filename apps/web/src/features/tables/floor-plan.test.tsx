import type { DiningTable, PutTablesRequest } from '@pos/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  branchDetail,
  branchManager,
  burgerBrand,
  page,
  pizzaBrand,
  pizzaDowntown,
  pizzaMall,
  sessionFor,
} from '../../test/fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const TABLES = `GET /api/v1/branches/${pizzaMall.id}/tables`;
const SAVE = `PUT /api/v1/branches/${pizzaMall.id}/tables`;

const drawer = {
  ...branchManager,
  permissions: [...branchManager.permissions, 'tables:write' as const],
};

const table = (overrides: Partial<DiningTable>): DiningTable => ({
  id: '01990000-0000-7000-8000-00000000e001',
  branchId: pizzaMall.id,
  name: '1',
  area: 'Inside',
  seats: 4,
  shape: 'square',
  x: 0,
  y: 0,
  width: 2,
  height: 2,
  isActive: true,
  ...overrides,
});

const saved = [
  table({}),
  table({ id: '01990000-0000-7000-8000-00000000e002', name: '7', area: 'Terrace', shape: 'round' }),
];

function planApi(handlers: Record<string, MockHandler> = {}, user = drawer) {
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(user)),
    [`GET /api/v1/branches/${pizzaMall.id}`]: () => json(branchDetail()),
    'GET /api/v1/brands': () => json(page([pizzaBrand, burgerBrand])),
    [`GET /api/v1/brands/${pizzaBrand.id}/branches`]: () => json(page([pizzaMall, pizzaDowntown])),
    [`GET /api/v1/brands/${burgerBrand.id}/branches`]: () => json(page([])),
    [TABLES]: () => json({ data: saved }),
    ...handlers,
  });
}

const open = () => renderApp(`/admin/branches/${pizzaMall.id}?tab=tables`);

describe('the floor plan of a branch', () => {
  it('shows the tables by area, and adds, moves and saves a table', async () => {
    const api = planApi({
      [SAVE]: ({ body }) =>
        json({
          data: (body as PutTablesRequest).tables.map((row, index) =>
            table({ ...row, id: row.id ?? `01990000-0000-7000-8000-00000000e10${index}` }),
          ),
        }),
    });
    const user = userEvent.setup();
    open();

    const inside = await screen.findByRole('group', { name: 'Inside' });
    expect(
      within(inside)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['1']);
    await user.click(screen.getByRole('button', { name: 'Terrace' }));
    expect(screen.getByRole('button', { name: 'Table 7, 4 seats' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Inside' }));

    // A new table goes to the first free spot, next to table 1, and is picked.
    await user.click(screen.getByRole('button', { name: 'Add table' }));
    const added = screen.getByRole('button', { name: 'Table 2, 4 seats' });
    expect(added).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Column')).toHaveValue(3);
    added.focus();
    await user.keyboard('{ArrowDown}{ArrowRight}');
    expect(screen.getByLabelText('Column')).toHaveValue(4);
    expect(screen.getByLabelText('Row')).toHaveValue(2);
    await user.clear(screen.getByLabelText('Seats'));
    await user.type(screen.getByLabelText('Seats'), '6');
    await user.selectOptions(screen.getByLabelText('Shape'), 'round');

    // Named like table 1, it is refused before saving.
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), '1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Table 1: Another table of this branch has this name.',
    );
    expect(api.count(SAVE)).toBe(0);

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), '2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('The floor plan was saved.');
    expect((api.calls.find((call) => call.key === SAVE)?.body as PutTablesRequest).tables).toEqual([
      {
        id: saved[0]?.id,
        name: '1',
        area: 'Inside',
        seats: 4,
        shape: 'square',
        x: 0,
        y: 0,
        width: 2,
        height: 2,
        isActive: true,
      },
      {
        id: saved[1]?.id,
        name: '7',
        area: 'Terrace',
        seats: 4,
        shape: 'round',
        x: 0,
        y: 0,
        width: 2,
        height: 2,
        isActive: true,
      },
      {
        name: '2',
        area: 'Inside',
        seats: 6,
        shape: 'round',
        x: 3,
        y: 1,
        width: 2,
        height: 2,
        isActive: true,
      },
    ]);
  });

  it('adds an area, and shows why the server refused the plan', async () => {
    planApi({
      [SAVE]: () => errorResponse(409, 'TABLE_IN_USE'),
    });
    const user = userEvent.setup();
    open();

    await screen.findByRole('group', { name: 'Inside' });
    await user.click(screen.getByRole('button', { name: 'Add area' }));
    await user.type(screen.getByLabelText('Name of the new area'), 'Family room{Enter}');
    expect(screen.getByRole('button', { name: 'Family room' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Add table' }));
    expect(screen.getByLabelText('Area')).toHaveValue('Family room');

    await user.click(screen.getByRole('button', { name: 'Terrace' }));
    await user.click(screen.getByRole('button', { name: 'Table 7, 4 seats' }));
    await user.click(screen.getByRole('button', { name: 'Remove table' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A table with an open order must stay in use. Pay or move its order first.',
    );
  });

  it('can only be looked at without the right to change it', async () => {
    planApi({}, branchManager);
    const user = userEvent.setup();
    open();

    await screen.findByRole('group', { name: 'Inside' });
    expect(screen.queryByRole('button', { name: 'Add table' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Table 1, 4 seats' }));
    expect(screen.getByLabelText('Name')).toBeDisabled();
  });
});
