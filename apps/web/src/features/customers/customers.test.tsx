import type { Customer, CustomerDetail } from '@pos/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  brandManager,
  burgerBrand,
  fullBrandManager,
  ids,
  page,
  pizzaBrand,
  pizzaMall,
  sessionFor,
} from '../../test/fixtures';
import { json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const saraId = '01990000-0000-7000-8000-00000000c001';
const LIST = 'GET /api/v1/customers';
const ONE = `GET /api/v1/customers/${saraId}`;
const EDIT = `PATCH /api/v1/customers/${saraId}`;
const ADJUST = `POST /api/v1/customers/${saraId}/points`;

const sara: Customer = {
  id: saraId,
  brandId: ids.pizza,
  phone: '+96555550000',
  name: 'Sara',
  email: null,
  notes: null,
  points: 120,
  visits: 4,
  totalSpent: '41.500',
  lastVisitAt: '2026-10-10T18:00:00.000Z',
  createdAt: '2026-09-01T18:00:00.000Z',
};
const noName: Customer = {
  ...sara,
  id: '01990000-0000-7000-8000-00000000c002',
  phone: '+96599991234',
  name: null,
  points: 0,
  visits: 0,
  totalSpent: '0.000',
  lastVisitAt: null,
};
const saraDetail: CustomerDetail = {
  ...sara,
  entries: [
    {
      id: '01990000-0000-7000-8000-00000000c101',
      kind: 'earn',
      points: 28,
      balanceAfter: 120,
      orderId: '01990000-0000-7000-8000-000000000701',
      orderNumber: 17,
      note: null,
      byName: 'Sara Cashier',
      createdAt: '2026-10-10T18:00:00.000Z',
    },
    {
      id: '01990000-0000-7000-8000-00000000c102',
      kind: 'redeem',
      points: -200,
      balanceAfter: 92,
      orderId: '01990000-0000-7000-8000-000000000702',
      orderNumber: 9,
      note: null,
      byName: 'Sara Cashier',
      createdAt: '2026-10-05T18:00:00.000Z',
    },
  ],
};

function customersApi(handlers: Record<string, MockHandler> = {}, user = fullBrandManager) {
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(user)),
    'GET /api/v1/brands': () => json(page([pizzaBrand, burgerBrand])),
    [`GET /api/v1/brands/${ids.pizza}/branches`]: () => json(page([pizzaMall])),
    [`GET /api/v1/brands/${ids.burger}/branches`]: () => json(page([])),
    'GET /api/v1/inventory/alerts': () => json({ data: [] }),
    ...handlers,
  });
}

describe('the customers page', () => {
  it('lists the brand customers and searches them', async () => {
    const api = customersApi({
      [LIST]: ({ url }) =>
        json(page(url.searchParams.get('q') === 'sara' ? [sara] : [sara, noName])),
    });
    const user = userEvent.setup();
    renderApp('/admin/customers');

    expect(await screen.findByRole('heading', { name: 'Customers' })).toBeVisible();
    const rows = await screen.findAllByRole('row');
    expect(rows.map((row) => row.textContent)).toEqual([
      'CustomerPointsVisitsSpentLast visit',
      expect.stringMatching(/^Sara\+96555550000120441\.500 KWD1[01] Oct 2026/),
      '+96599991234000.000 KWD—',
    ]);
    expect(api.calls.find((call) => call.key === LIST)?.url.searchParams.get('brandId')).toBe(
      ids.pizza,
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'sara');
    await screen.findByText(
      (_, element) => element?.tagName === 'TBODY' && element.children.length === 1,
    );
    expect(screen.getByRole('link', { name: 'Sara' })).toHaveAttribute(
      'href',
      `/admin/customers/${saraId}`,
    );
  });

  it('is not in the menu of a person who cannot see customers', async () => {
    customersApi({}, brandManager);
    renderApp('/admin');
    const menu = within(await screen.findByRole('navigation', { name: 'Main menu' }));
    await menu.findByRole('link', { name: 'Menu' });
    expect(menu.queryByRole('link', { name: 'Customers' })).not.toBeInTheDocument();
  });
});

describe('a customer page', () => {
  it('shows the points history and gives points with a reason', async () => {
    let current = saraDetail;
    const api = customersApi({
      [ONE]: () => json(current),
      [ADJUST]: ({ body }) => {
        const { points, reason } = body as { points: number; reason: string };
        current = {
          ...current,
          points: current.points + points,
          entries: [
            {
              id: '01990000-0000-7000-8000-00000000c103',
              kind: 'adjust',
              points,
              balanceAfter: current.points + points,
              orderId: null,
              orderNumber: null,
              note: reason,
              byName: 'Pizza Palace Manager',
              createdAt: '2026-10-13T10:00:00.000Z',
            },
            ...current.entries,
          ],
        };
        return json(current);
      },
    });
    const user = userEvent.setup();
    renderApp(`/admin/customers/${saraId}`);

    expect(await screen.findByRole('heading', { name: 'Sara' })).toBeVisible();
    expect(screen.getByTestId('customer-points')).toHaveTextContent('120');
    const history = within(screen.getByRole('region', { name: 'Points history' }));
    expect(history.getAllByRole('row').map((row) => row.textContent)).toEqual([
      'WhenWhatPointsBalanceBy',
      expect.stringMatching(/Earned · Order 17\+28120Sara Cashier$/),
      expect.stringMatching(/Spent · Order 9-20092Sara Cashier$/),
    ]);

    // Taking more than they have is refused before it is sent.
    const form = within(screen.getByRole('form', { name: 'Give or take points' }));
    await user.click(form.getByRole('radio', { name: 'Take' }));
    await user.type(form.getByLabelText('Points'), '500');
    await user.type(form.getByLabelText('Reason'), 'Mistake');
    await user.click(form.getByRole('button', { name: 'Take points' }));
    expect(form.getByLabelText('Points')).toHaveAccessibleDescription(
      'The customer does not have that many points.',
    );
    expect(api.count(ADJUST)).toBe(0);

    await user.click(form.getByRole('radio', { name: 'Give' }));
    await user.clear(form.getByLabelText('Points'));
    await user.type(form.getByLabelText('Points'), '50');
    await user.clear(form.getByLabelText('Reason'));
    await user.type(form.getByLabelText('Reason'), 'Cold pizza');
    await user.click(form.getByRole('button', { name: 'Give points' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The points were changed.');
    expect(api.calls.find((call) => call.key === ADJUST)?.body).toEqual({
      points: 50,
      reason: 'Cold pizza',
    });
    expect(screen.getByTestId('customer-points')).toHaveTextContent('170');
    expect(history.getAllByRole('row')[1]).toHaveTextContent(/By hand\s*Cold pizza\+50170/);
  });

  it('changes the name, email and notes', async () => {
    let current = saraDetail;
    const api = customersApi({
      [ONE]: () => json(current),
      [EDIT]: ({ body }) => {
        current = { ...current, ...(body as Partial<CustomerDetail>) };
        return json(current);
      },
    });
    const user = userEvent.setup();
    renderApp(`/admin/customers/${saraId}`);

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
      'Type an email address like name@example.com.',
    );
    expect(api.count(EDIT)).toBe(0);

    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'sara@x.io');
    await user.type(screen.getByLabelText('Notes'), 'No onions');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('No onions')).toBeVisible();
    expect(api.calls.find((call) => call.key === EDIT)?.body).toEqual({
      name: 'Sara',
      email: 'sara@x.io',
      notes: 'No onions',
    });
  });

  it('shows no way to change a customer to a branch manager', async () => {
    const mallManager = { ...fullBrandManager, permissions: ['customers:read'] as const };
    customersApi(
      { [ONE]: () => json(saraDetail) },
      { ...mallManager, permissions: [...mallManager.permissions] },
    );
    renderApp(`/admin/customers/${saraId}`);

    expect(await screen.findByRole('heading', { name: 'Sara' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Give or take points' })).not.toBeInTheDocument();
  });
});
