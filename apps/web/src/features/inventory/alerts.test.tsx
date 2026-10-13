import type { BranchStock, BranchStockAlerts, Ingredient } from '@pos/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { describe, expect, it } from 'vitest';
import {
  branchManager,
  ids,
  page,
  pizzaBrand,
  pizzaDowntown,
  pizzaMall,
  sessionFor,
} from '../../test/fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const ALERTS = 'GET /api/v1/inventory/alerts';
const STOCK = 'GET /api/v1/inventory/stock';

const ingredient = (n: number, en: string, ar: string): Ingredient => ({
  id: `01990000-0000-7000-8000-00000000900${n}`,
  brandId: ids.pizza,
  name: { en, ar },
  unit: 'kg',
  costPerUnit: '1.000',
  lowLevel: '2.000',
  isActive: true,
});
const flour = ingredient(1, 'Flour', 'طحين');
const mozzarella = ingredient(2, 'Mozzarella', 'موزاريلا');

const mallAlerts: BranchStockAlerts = {
  branch: { id: ids.pizzaMall, brandId: ids.pizza, name: pizzaMall.name },
  items: [
    { ingredient: flour, quantity: '0.000', level: '5.000', status: 'out' },
    { ingredient: mozzarella, quantity: '0.500', level: '2.000', status: 'low' },
  ],
};

// The Mall's manager: sees the Mall's stock and its alerts.
const manager = {
  ...branchManager,
  permissions: [...branchManager.permissions, 'inventory:read' as const],
};

const stockOf = (row: Ingredient, quantity: string, isLow: boolean): BranchStock => ({
  branchId: ids.pizzaMall,
  ingredient: row,
  quantity,
  lowLevel: null,
  isLow,
  value: '0.000',
});

function alertsApi(handlers: Record<string, MockHandler> = {}, user = manager) {
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(user)),
    'GET /api/v1/brands': () => json(page([pizzaBrand])),
    [`GET /api/v1/brands/${ids.pizza}/branches`]: () => json(page([pizzaMall, pizzaDowntown])),
    [ALERTS]: () => json({ data: [mallAlerts] }),
    ...handlers,
  });
}

describe('the stock alerts on the dashboard', () => {
  it('show each branch with what is out and low, and open its low stock', async () => {
    const api = alertsApi({
      [STOCK]: () =>
        json({
          data: [
            stockOf(flour, '0.000', true),
            stockOf(mozzarella, '0.500', true),
            stockOf(ingredient(3, 'Cola', 'كولا'), '50.000', false),
          ],
        }),
    });
    const user = userEvent.setup();
    renderApp('/admin');

    const panel = (await screen.findByRole('heading', { name: 'Stock alerts' })).closest(
      'section',
    ) as HTMLElement;
    const mall = await within(panel).findByRole('listitem', { name: 'Pizza Palace - Mall Branch' });
    expect(within(mall).getByText('1 out, 1 low')).toBeVisible();
    const [first, second] = within(mall).getAllByRole('listitem');
    expect(first).toHaveTextContent('OutFlour0.000 of 5.000 kg');
    expect(within(first as HTMLElement).getByText('Out')).toHaveClass('text-red-800');
    expect(second).toHaveTextContent('LowMozzarella0.500 of 2.000 kg');

    await user.click(
      within(mall).getByRole('link', {
        name: 'See all the low stock of Pizza Palace - Mall Branch',
      }),
    );
    expect(await screen.findByLabelText('Only what is low')).toBeChecked();
    expect(await screen.findByText('Mozzarella')).toBeVisible();
    expect(screen.queryByText('Cola')).not.toBeInTheDocument();
    expect(api.calls.find((call) => call.key === STOCK)?.url.searchParams.get('branchId')).toBe(
      ids.pizzaMall,
    );
  });

  it('show only the first five of a branch and say how many more there are', async () => {
    alertsApi({
      [ALERTS]: () =>
        json({
          data: [
            {
              ...mallAlerts,
              items: Array.from({ length: 7 }, (_, n) => ({
                ingredient: ingredient(n + 1, `Item ${n + 1}`, `صنف ${n + 1}`),
                quantity: '0.000',
                level: '1.000',
                status: 'out',
              })),
            },
          ],
        }),
    });
    renderApp('/admin');

    const mall = await screen.findByRole('listitem', { name: 'Pizza Palace - Mall Branch' });
    expect(within(mall).getAllByRole('listitem')).toHaveLength(5);
    expect(within(mall).getByRole('link')).toHaveTextContent('See 2 more');
  });

  it('say so when nothing is low', async () => {
    alertsApi({ [ALERTS]: () => json({ data: [] }) });
    renderApp('/admin');
    expect(await screen.findByText('All ingredients are above their level.')).toBeVisible();
  });

  it('say so when they cannot be loaded', async () => {
    alertsApi({ [ALERTS]: () => errorResponse(500, 'INTERNAL_ERROR') });
    renderApp('/admin');
    const panel = (await screen.findByRole('heading', { name: 'Stock alerts' })).closest(
      'section',
    ) as HTMLElement;
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Could not load the data.');
  });

  it('are not shown, nor asked for, to a person who does not see the stock', async () => {
    const api = alertsApi({}, branchManager);
    renderApp('/admin');

    expect(await screen.findByText('Pizza Palace - Mall Branch')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Stock alerts' })).not.toBeInTheDocument();
    expect(api.count(ALERTS)).toBe(0);
  });

  it('are shown in Arabic', async () => {
    await i18n.changeLanguage('ar');
    alertsApi();
    renderApp('/admin');

    expect(await screen.findByRole('heading', { name: 'تنبيهات المخزون' })).toBeVisible();
    expect(await screen.findByText('1 نافد، 1 منخفض')).toBeVisible();
    expect(screen.getByText('طحين')).toBeVisible();
    await i18n.changeLanguage('en');
  });
});
