import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  branchManager,
  brandManager,
  cashier,
  fullBrandManager,
  groupAdmin,
  page,
  pizzaBrand,
  pizzaMall,
  sessionFor,
} from '../../test/fixtures';
import { json, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const REFRESH = 'POST /api/v1/auth/refresh';
const BRANDS = 'GET /api/v1/brands';
const branchesOf = `GET /api/v1/brands/${pizzaBrand.id}/branches`;

async function menuOf(session: Parameters<typeof sessionFor>[0]) {
  mockApi({
    [REFRESH]: () => json(sessionFor(session)),
    [BRANDS]: () => json(page([pizzaBrand])),
    [branchesOf]: () => json(page([pizzaMall])),
  });
  renderApp('/admin');
  await screen.findByText(`Welcome, ${session.name}`);

  return within(screen.getByRole('navigation', { name: 'Main menu' }))
    .getAllByRole('link')
    .map((link) => link.textContent);
}

describe('the main menu shows each person only what they may open', () => {
  it('shows a group admin every area', async () => {
    expect(await menuOf(groupAdmin)).toEqual([
      'Dashboard',
      'Brands',
      'Branches',
      'Users',
      'Roles',
      'Audit log',
    ]);
  });

  it('shows a brand manager the brands and branches of their brand, and their people', async () => {
    expect(await menuOf(fullBrandManager)).toEqual([
      'Dashboard',
      'Brands',
      'Branches',
      'Users',
      'Roles',
      'Audit log',
    ]);
  });

  it('shows a person who can only read brands and branches those two areas', async () => {
    expect(await menuOf(brandManager)).toEqual(['Dashboard', 'Brands', 'Branches']);
  });

  it('shows a branch manager their branch and their people, but not the brands', async () => {
    expect(await menuOf(branchManager)).toEqual(['Dashboard', 'Branches', 'Users']);
  });

  it('shows a cashier only the dashboard', async () => {
    expect(await menuOf(cashier)).toEqual(['Dashboard']);
  });
});
