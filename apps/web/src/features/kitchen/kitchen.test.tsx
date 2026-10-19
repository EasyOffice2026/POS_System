import type { KitchenTicket } from '@pos/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import {
  brandSettings,
  shiftSummary,
  fullBrandManager,
  fullCashier,
  ids,
  kitchenStaff,
  page,
  pizzaBrand,
  pizzaMall,
  sessionFor,
} from '../../test/fixtures';
import { branchMenu } from '../../test/menu-fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { order, orderIds, orderLine, orderSummary } from '../../test/order-fixtures';
import { renderApp } from '../../test/render-app';
import { forgetTerminal, saveTerminal } from '../pos/terminal-store';

const TICKETS = 'GET /api/v1/kitchen/tickets';
const ticketIds = {
  first: '01990000-0000-7000-8000-000000000a01',
  second: '01990000-0000-7000-8000-000000000a02',
};

afterEach(() => {
  forgetTerminal();
});

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function ticket(overrides: Partial<KitchenTicket> = {}): KitchenTicket {
  return {
    id: ticketIds.first,
    orderId: orderIds.first,
    orderNumber: 12,
    orderType: 'dine_in',
    orderNote: null,
    tableName: null,
    stationId: null,
    status: 'new',
    sentAt: minutesAgo(2.5),
    startedAt: null,
    readyAt: null,
    doneAt: null,
    lines: [
      {
        id: '01990000-0000-7000-8000-000000000801',
        name: { en: 'Margherita', ar: 'مارجريتا' },
        quantity: 2,
        modifiers: [
          {
            id: '01990000-0000-7000-8000-000000000611',
            groupId: '01990000-0000-7000-8000-000000000601',
            name: { en: 'Large', ar: 'كبير' },
            priceDelta: '6.000',
          },
        ],
        choices: [],
        note: 'No onions',
        voided: false,
      },
      {
        id: '01990000-0000-7000-8000-000000000802',
        name: { en: 'Cola', ar: 'كولا' },
        quantity: 1,
        modifiers: [],
        choices: [],
        note: null,
        voided: true,
      },
    ],
    ...overrides,
  };
}

function kitchenApi(handlers: Record<string, MockHandler> = {}, user = kitchenStaff) {
  saveTerminal({
    branchId: ids.pizzaMall,
    brandId: ids.pizza,
    branchName: pizzaMall.name,
    brandName: pizzaBrand.name,
  });
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(user)),
    [TICKETS]: () => json({ data: [ticket()] }),
    [`GET /api/v1/brands/${ids.pizza}/settings`]: () => json(brandSettings()),
    'GET /api/v1/shifts/current': () => json(shiftSummary()),
    ...handlers,
  });
}

describe('the kitchen screen', () => {
  it('has a way back to the back office for a manager', async () => {
    kitchenApi({}, fullBrandManager);
    renderApp('/kds');
    expect(await screen.findByRole('link', { name: 'Back office' })).toHaveAttribute(
      'href',
      '/admin',
    );
  });

  it('has no back office link for the kitchen staff', async () => {
    kitchenApi();
    renderApp('/kds');
    expect(await screen.findByText(/waiting/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back office' })).not.toBeInTheDocument();
  });

  it('shows a ticket with its dishes, and the voided one as VOID (criteria 1 and 4)', async () => {
    const api = kitchenApi();
    renderApp('/kds');

    const card = await screen.findByRole('article', { name: 'Order 12' });
    expect(within(card).getByText('Dine-in')).toBeVisible();
    expect(within(card).getByText('2 min')).toBeVisible();
    expect(within(card).getByText('Large')).toBeVisible();
    expect(within(card).getByText('No onions')).toBeVisible();
    expect(within(card).getByText('VOID')).toBeVisible();
    expect(screen.getByText('1 ticket waiting')).toBeVisible();
    expect(api.calls.find((call) => call.key === TICKETS)?.url.searchParams.get('branchId')).toBe(
      ids.pizzaMall,
    );
  });

  it('starts a ticket from the status the screen saw (criterion 2)', async () => {
    const api = kitchenApi({
      [`PATCH /api/v1/kitchen/tickets/${ticketIds.first}`]: () =>
        json(ticket({ status: 'preparing', startedAt: minutesAgo(0) })),
    });
    const user = userEvent.setup();
    renderApp('/kds');

    const card = await screen.findByRole('article', { name: 'Order 12' });
    await user.click(within(card).getByRole('button', { name: 'Start' }));

    expect(
      api.calls.find((call) => call.key === `PATCH /api/v1/kitchen/tickets/${ticketIds.first}`)
        ?.body,
    ).toEqual({ from: 'new', to: 'preparing' });
  });

  it('says so when another screen moved the ticket first, and loads again (criterion 3)', async () => {
    const api = kitchenApi({
      [`PATCH /api/v1/kitchen/tickets/${ticketIds.first}`]: () =>
        errorResponse(409, 'TICKET_CHANGED'),
    });
    const user = userEvent.setup();
    renderApp('/kds');

    const card = await screen.findByRole('article', { name: 'Order 12' });
    await user.click(within(card).getByRole('button', { name: 'Start' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This ticket was moved on another screen.',
    );
    await waitFor(() => expect(api.count(TICKETS)).toBeGreaterThan(1));
  });

  it('recalls a ticket that was done (criterion 5)', async () => {
    const done = ticket({
      id: ticketIds.second,
      orderNumber: 9,
      status: 'done',
      doneAt: minutesAgo(1),
    });
    const api = kitchenApi({
      [TICKETS]: () => json({ data: [done] }),
      [`PATCH /api/v1/kitchen/tickets/${ticketIds.second}`]: () =>
        json({ ...done, status: 'ready', doneAt: null }),
    });
    const user = userEvent.setup();
    renderApp('/kds');

    const shelf = await screen.findByRole('region', { name: 'Done' });
    expect(screen.getByText('Nothing to make. New orders appear here.')).toBeVisible();
    await user.click(within(shelf).getByRole('button', { name: 'Recall' }));

    expect(
      api.calls.find((call) => call.key === `PATCH /api/v1/kitchen/tickets/${ticketIds.second}`)
        ?.body,
    ).toEqual({ from: 'done', to: 'ready' });
  });

  it('lets a cashier look without buttons (criterion 6)', async () => {
    kitchenApi({}, fullCashier);
    renderApp('/kds');

    const card = await screen.findByRole('article', { name: 'Order 12' });
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  });

  it('turns a ticket red after 20 minutes', async () => {
    kitchenApi({ [TICKETS]: () => json({ data: [ticket({ sentAt: minutesAgo(25.5) })] }) });
    renderApp('/kds');

    const card = await screen.findByRole('article', { name: 'Order 12' });
    expect(within(card).getByText('25 min')).toHaveClass('text-red-700');
  });

  it('comes back to the kitchen screen after a manager signs in and sets it up', async () => {
    let signedIn = false;
    mockApi({
      'POST /api/v1/auth/refresh': () => errorResponse(401, 'UNAUTHENTICATED'),
      'POST /api/v1/auth/login': () => {
        signedIn = true;
        return json(sessionFor(fullBrandManager));
      },
      'GET /api/v1/brands': () => json(page([pizzaBrand])),
      [`GET /api/v1/brands/${ids.pizza}/branches`]: () => json(page([pizzaMall])),
      'POST /api/v1/auth/logout': () => new Response(null, { status: 204 }),
    });
    const user = userEvent.setup();
    const { router } = renderApp('/kds');

    await user.click(await screen.findByRole('link', { name: 'Set up this terminal' }));
    await user.type(await screen.findByLabelText('Email'), 'pizza.manager@pos.local');
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.click(await screen.findByRole('radio', { name: /Mall Branch/ }));
    await user.click(screen.getByRole('button', { name: 'Use this branch' }));

    expect(await screen.findByLabelText('Staff code')).toBeVisible();
    expect(router.state.location.pathname).toBe('/kds');
    expect(signedIn).toBe(true);
  });

  it('links a terminal that is not set up to the setup, and back to the kitchen', async () => {
    mockApi({ 'POST /api/v1/auth/refresh': () => errorResponse(401, 'UNAUTHENTICATED') });
    renderApp('/kds');

    expect(await screen.findByRole('link', { name: 'Set up this terminal' })).toHaveAttribute(
      'href',
      '/pos/setup?next=/kds',
    );
  });
});

describe('the POS', () => {
  it('shows which sent dishes the kitchen has made', async () => {
    const withReady = order({
      lines: [
        orderLine({ status: 'sent', kitchenStatus: 'ready', sentAt: minutesAgo(5) }),
        orderLine({
          id: '01990000-0000-7000-8000-000000000803',
          name: { en: 'Tiramisu', ar: 'تيراميسو' },
          status: 'sent',
          kitchenStatus: 'preparing',
          sentAt: minutesAgo(5),
        }),
      ],
    });
    kitchenApi(
      {
        'GET /api/v1/menu': () => json(branchMenu()),
        'GET /api/v1/orders': () => json(page([orderSummary(withReady)])),
        [`GET /api/v1/orders/${orderIds.first}`]: () => json(withReady),
      },
      fullCashier,
    );
    const user = userEvent.setup();
    renderApp('/pos');

    await user.click(await screen.findByRole('button', { name: 'Open orders' }));
    await user.click(await screen.findByRole('button', { name: /Order 1/ }));

    const panel = screen.getByRole('region', { name: 'Order' });
    expect(await within(panel).findByText('Ready')).toBeVisible();
    expect(within(panel).getByText('Preparing')).toBeVisible();
  });
});
