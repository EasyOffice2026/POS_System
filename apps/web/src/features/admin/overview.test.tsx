import type { Overview } from '@pos/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  branchManager,
  burgerBrand,
  fullBrandManager,
  groupAdmin,
  ids,
  page,
  pizzaBrand,
  pizzaDowntown,
  pizzaMall,
  sessionFor,
} from '../../test/fixtures';
import { json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';
import { changeAgainst } from './GroupOverview';

const OVERVIEW = 'GET /api/v1/reports/overview';

const overview = (overrides: Partial<Overview> = {}): Overview => ({
  generatedAt: '2026-10-15T18:00:00.000Z',
  summary: {
    sales: '35.000',
    orders: 3,
    averageOrder: '11.667',
    discounts: '1.500',
    refunds: '2.000',
    voidedOrders: 1,
    lastWeekSales: '28.000',
    lastWeekOrders: 4,
  },
  branches: [
    {
      id: ids.pizzaMall,
      brandId: ids.pizza,
      name: pizzaMall.name,
      brandName: pizzaBrand.name,
      businessDate: '2026-10-15',
      sales: '30.000',
      orders: 2,
      lastWeekSales: '20.000',
      openOrders: 1,
      openTotal: '8.000',
      tablesInUse: 1,
      tables: 10,
      openShifts: 2,
    },
    {
      id: ids.pizzaDowntown,
      brandId: ids.pizza,
      name: pizzaDowntown.name,
      brandName: pizzaBrand.name,
      businessDate: '2026-10-15',
      sales: '5.000',
      orders: 1,
      lastWeekSales: '8.000',
      openOrders: 0,
      openTotal: '0.000',
      tablesInUse: 0,
      tables: 0,
      openShifts: 1,
    },
  ],
  hours: Array.from({ length: 24 }, (_, hour) => ({
    hour,
    sales: hour === 12 ? '10.000' : hour === 19 ? '25.000' : '0.000',
    orders: hour === 12 ? 1 : hour === 19 ? 2 : 0,
  })),
  topItems: [
    {
      kind: 'item',
      id: '01990000-0000-7000-8000-000000000301',
      name: { en: 'Cola', ar: 'كولا' },
      quantity: 5,
      sales: '25.000',
    },
  ],
  attention: [
    {
      kind: 'old_shift',
      branchId: ids.pizzaMall,
      count: 1,
      amount: '0.000',
      name: 'Sara Cashier',
      since: '2026-10-14T10:00:00.000Z',
    },
    {
      kind: 'refunds',
      branchId: ids.pizzaDowntown,
      count: 1,
      amount: '2.000',
      name: null,
      since: null,
    },
  ],
  ...overrides,
});

function dashboardApi(user = groupAdmin, handlers: Record<string, MockHandler> = {}) {
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(user)),
    'GET /api/v1/brands': () => json(page([pizzaBrand, burgerBrand])),
    [`GET /api/v1/brands/${ids.pizza}/branches`]: () => json(page([pizzaMall, pizzaDowntown])),
    [`GET /api/v1/brands/${ids.burger}/branches`]: () => json(page([])),
    'GET /api/v1/inventory/alerts': () => json({ data: [] }),
    [OVERVIEW]: () => json(overview()),
    ...handlers,
  });
}

describe('the overview of today on the dashboard', () => {
  it('shows the figures, the branches, the hours, the top dishes and what needs attention', async () => {
    dashboardApi();
    renderApp('/admin');

    const today = await screen.findByRole('region', { name: 'Today' });
    expect(await within(today).findByText('Sales', { selector: 'p' })).toBeVisible();
    const sales = within(today).getByText('Sales', { selector: 'p' }).parentElement as HTMLElement;
    expect(sales).toHaveTextContent('35.000 KWD+25% on last week at this time');
    const orders = within(today).getByText('Orders', { selector: 'p' })
      .parentElement as HTMLElement;
    expect(orders).toHaveTextContent('3-25% on last week at this time');
    expect(within(today).getByText('1 order voided')).toBeVisible();

    const table = within(today).getByRole('table', { name: 'Branches' });
    expect(
      within(table)
        .getAllByRole('row')
        .map((row) => row.textContent),
    ).toEqual([
      'BranchSalesLast weekOrdersOpen ordersTables in useOpen shifts',
      'Pizza Palace - Mall BranchPizza Palace30.000 KWD20.000 KWD21 · 8.000 KWD1 / 102',
      'Pizza Palace - Downtown BranchPizza Palace5.000 KWD8.000 KWD10—1',
    ]);

    const hours = within(today).getByRole('list', { name: 'Sales by hour' });
    expect(within(hours).getAllByRole('listitem')).toHaveLength(8);
    expect(hours).toHaveTextContent('12:00: 10.000 KWD, 1 order');
    expect(hours).toHaveTextContent('19:00: 25.000 KWD, 2 orders');
    expect(within(today).getByText('Cola').closest('li')).toHaveTextContent(
      '1. Cola × 525.000 KWD',
    );

    const attention = within(today).getByText('Needs attention').parentElement as HTMLElement;
    const rows = within(attention).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent(
      "Pizza Palace - Mall Branch: Sara Cashier's shift is still open since",
    );
    expect(
      within(rows[0] as HTMLElement).getByRole('link', { name: 'See the shifts' }),
    ).toHaveAttribute('href', '/admin/shifts');
    expect(rows[1]).toHaveTextContent('Pizza Palace - Downtown Branch: 1 refund today, 2.000 KWD');
  });

  it('lets a group admin look at one brand', async () => {
    const api = dashboardApi();
    const user = userEvent.setup();
    renderApp('/admin');

    const today = await screen.findByRole('region', { name: 'Today' });
    await within(today).findByRole('table', { name: 'Branches' });
    await user.selectOptions(within(today).getByLabelText('Brand'), ids.burger);
    await waitFor(() => expect(api.count(OVERVIEW)).toBe(2));
    const calls = api.calls.filter((call) => call.key === OVERVIEW);
    expect(calls.map((call) => call.url.searchParams.get('brandId'))).toEqual([null, ids.burger]);
  });

  it('is shown to a brand manager without a brand picker, and never to a branch manager', async () => {
    dashboardApi(fullBrandManager);
    renderApp('/admin');
    const today = await screen.findByRole('region', { name: 'Today' });
    await within(today).findByRole('table', { name: 'Branches' });
    expect(within(today).queryByLabelText('Brand')).not.toBeInTheDocument();
  });

  it('is not asked for by a branch manager', async () => {
    const api = dashboardApi({ ...branchManager, permissions: ['branches:read', 'reports:read'] });
    renderApp('/admin');
    await screen.findByRole('heading', { name: 'Dashboard' });
    await screen.findByText('Pizza Palace - Mall Branch');
    expect(screen.queryByRole('region', { name: 'Today' })).not.toBeInTheDocument();
    expect(api.count(OVERVIEW)).toBe(0);
  });
});

describe('the change against last week', () => {
  it('is a whole percentage, or nothing when last week had nothing', () => {
    expect(changeAgainst(35_000, 28_000)).toBe(25);
    expect(changeAgainst(5_000, 8_000)).toBe(-38);
    expect(changeAgainst(5_000, 0)).toBeNull();
  });
});
