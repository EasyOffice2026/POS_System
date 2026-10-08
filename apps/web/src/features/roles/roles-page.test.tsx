import { permissions, systemRoles } from '@pos/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { cashier, groupAdmin, page, pizzaBrand, rolesFor, sessionFor } from '../../test/fixtures';
import { errorResponse, json, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const REFRESH = 'POST /api/v1/auth/refresh';
const ROLES = 'GET /api/v1/roles';

function openRoles() {
  return mockApi({
    [REFRESH]: () => json(sessionFor(groupAdmin)),
    [ROLES]: () => json({ data: rolesFor('group') }),
  });
}

describe('the roles page', () => {
  it('shows every role as a column and every permission as a row', async () => {
    openRoles();
    renderApp('/admin/roles');

    const table = await screen.findByRole('table');

    const headers = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual([
      'Permission',
      'Group Admin',
      'Brand Manager',
      'Marketing',
      'Branch Manager',
      'Cashier',
      'Kitchen',
      'Purchaser',
    ]);
    const rowHeaders = within(table)
      .getAllByRole('rowheader')
      .map((cell) => cell.textContent);
    expect(rowHeaders).toHaveLength(1 + permissions.length);
    expect(rowHeaders).toEqual(expect.arrayContaining(['Scope', 'See brands', 'Change the menu']));
  });

  it('shows the scope of each role', async () => {
    openRoles();
    renderApp('/admin/roles');

    const row = (await screen.findByRole('rowheader', { name: 'Scope' })).closest('tr');

    expect(
      within(row as HTMLElement)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(
      systemRoles.map((role) => ({ GROUP: 'Group', BRAND: 'Brand', BRANCH: 'Branch' })[role.scope]),
    );
  });

  it('shows what each role may do, in words for screen readers', async () => {
    openRoles();
    renderApp('/admin/roles');

    const row = (await screen.findByRole('rowheader', { name: 'Change brands' })).closest('tr');
    const cells = within(row as HTMLElement).getAllByRole('cell');

    // Only the group admin may change brands.
    expect(cells[0]).toHaveTextContent('Allowed');
    for (const cell of cells.slice(1)) expect(cell).toHaveTextContent('Not allowed');
    expect(within(cells[0] as HTMLElement).getByText('✓')).toHaveAttribute('aria-hidden', 'true');
  });

  it('matches the permissions defined in the code', async () => {
    openRoles();
    renderApp('/admin/roles');
    const table = await screen.findByRole('table');

    const cashierColumn = systemRoles.findIndex((role) => role.key === 'cashier');
    // Skip the heading row and the scope row.
    const permissionRows = within(table).getAllByRole('row').slice(2);
    const allowed = permissionRows
      .filter((row) => within(row).getAllByRole('cell')[cashierColumn]?.textContent?.includes('✓'))
      .map((row) => within(row).getByRole('rowheader').textContent);

    expect(allowed).toEqual(['See the menu']);
  });

  it('is written in Arabic when the language is switched', async () => {
    const user = userEvent.setup();
    openRoles();
    renderApp('/admin/roles');
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    expect(await screen.findByRole('heading', { name: 'الأدوار' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'أمين الصندوق' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'عرض سجل المراجعة' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'النطاق' })).toBeInTheDocument();
  });

  it('says so when the roles cannot be loaded', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(groupAdmin)),
      [ROLES]: () => errorResponse(500, 'INTERNAL_ERROR'),
    });
    renderApp('/admin/roles');

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the data.');
  });

  it('tells a cashier they may not open it, and asks the server for nothing', async () => {
    const api = mockApi({
      [REFRESH]: () => json(sessionFor(cashier)),
      [`GET /api/v1/brands/${pizzaBrand.id}/branches`]: () => json(page([])),
    });
    renderApp('/admin/roles');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to open this page.',
    );
    expect(api.count(ROLES)).toBe(0);
  });
});
