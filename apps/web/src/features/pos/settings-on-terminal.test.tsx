import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import {
  brandSettings,
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
import { json, type MockHandler, mockApi } from '../../test/mock-api';
import { order, orderIds, orderLine, orderSummary } from '../../test/order-fixtures';
import { renderApp } from '../../test/render-app';
import { forgetTerminal, readTerminal, saveTerminal } from './terminal-store';

const SETTINGS = `GET /api/v1/brands/${ids.pizza}/settings`;
const ticketId = '01990000-0000-7000-8000-000000000a01';
const stations = [
  { id: '01990000-0000-7000-8000-00000000a001', name: { en: 'Pizza oven', ar: 'فرن البيتزا' } },
  { id: '01990000-0000-7000-8000-00000000a002', name: { en: 'Drinks', ar: 'مشروبات' } },
];

afterEach(() => {
  forgetTerminal();
});

const mall = {
  branchId: ids.pizzaMall,
  brandId: ids.pizza,
  branchName: pizzaMall.name,
  brandName: pizzaBrand.name,
};

// An open order with a Cola that the kitchen has made.
const readyOrder = order({
  lines: [
    orderLine({
      status: 'sent',
      kitchenStatus: 'ready',
      ticketId,
      sentAt: '2026-10-13T09:01:00.000Z',
      lineTotal: '5.000',
    }),
  ],
  subtotal: '5.000',
  total: '5.000',
});

function terminalApi(settings = brandSettings(), handlers: Record<string, MockHandler> = {}) {
  saveTerminal(mall);
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(fullCashier)),
    'GET /api/v1/menu': () => json(branchMenu()),
    [SETTINGS]: () => json(settings),
    'GET /api/v1/orders': () => json(page([orderSummary(readyOrder)])),
    [`GET /api/v1/orders/${orderIds.first}`]: () => json(readyOrder),
    ...handlers,
  });
}

async function openReadyOrder(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Open orders' }));
  await user.click(await screen.findByRole('button', { name: /Order 1/ }));
  return screen.getByRole('region', { name: 'Order' });
}

describe('the settings on the POS', () => {
  it('shows the discount buttons of the brand', async () => {
    terminalApi(brandSettings({ discountPresets: ['7.50', '30.00'] }));
    const user = userEvent.setup();
    renderApp('/pos');

    await openReadyOrder(user);
    await user.click(screen.getByRole('button', { name: 'Discount' }));
    const dialog = screen.getByRole('dialog', { name: 'Discount on the order' });
    expect(dialog.querySelectorAll('button[type=button]').length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('button', { name: '7.5%' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: '30%' })).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: '10%' })).not.toBeInTheDocument();
  });

  it('offers the ways to pay of the brand', async () => {
    terminalApi(
      brandSettings({
        paymentMethods: [
          { key: 'knet', name: { en: 'KNET', ar: 'كي نت' }, isActive: true },
          { key: 'talabat', name: { en: 'Talabat', ar: 'طلبات' }, isActive: true },
          { key: 'link', name: { en: 'Link', ar: 'لينك' }, isActive: false },
        ],
      }),
    );
    const user = userEvent.setup();
    renderApp('/pos');

    await openReadyOrder(user);
    await user.click(screen.getByRole('button', { name: /^Pay/ }));
    const dialog = screen.getByRole('dialog', { name: 'Pay order 1' });
    expect(within(dialog).getByRole('button', { name: 'Cash' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'KNET' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Talabat' })).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Link' })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Mixed' }));
    expect(within(dialog).getByLabelText('Paid by')).toHaveValue('knet');
    await user.selectOptions(within(dialog).getByLabelText('Paid by'), 'talabat');
    expect(within(dialog).getByLabelText('Amount by Talabat')).toBeVisible();
  });

  it('lets the cashier mark a ready dish done when the brand says so (criterion 7)', async () => {
    const api = terminalApi(brandSettings({ ticketDoneBy: 'cashier' }), {
      [`PATCH /api/v1/kitchen/tickets/${ticketId}`]: () => json({ id: ticketId, status: 'done' }),
    });
    const user = userEvent.setup();
    renderApp('/pos');

    const panel = await openReadyOrder(user);
    await user.click(await within(panel).findByRole('button', { name: 'Mark done: Cola' }));

    expect(
      api.calls.find((call) => call.key === `PATCH /api/v1/kitchen/tickets/${ticketId}`)?.body,
    ).toEqual({ from: 'ready', to: 'done' });
  });

  it('has no such button when the kitchen marks dishes done', async () => {
    terminalApi();
    const user = userEvent.setup();
    renderApp('/pos');

    const panel = await openReadyOrder(user);
    expect(await within(panel).findByText('Ready')).toBeVisible();
    expect(within(panel).queryByRole('button', { name: /Mark done/ })).not.toBeInTheDocument();
  });
});

describe('the settings on the kitchen screen', () => {
  const ticket = {
    id: ticketId,
    orderId: orderIds.first,
    orderNumber: 4,
    orderType: 'takeaway',
    orderNote: null,
    stationId: stations[0]?.id,
    status: 'ready',
    sentAt: new Date().toISOString(),
    startedAt: null,
    readyAt: new Date().toISOString(),
    doneAt: null,
    lines: [],
  };

  it('stops at Ready when the cashier marks dishes done', async () => {
    saveTerminal(mall);
    mockApi({
      'POST /api/v1/auth/refresh': () => json(sessionFor(kitchenStaff)),
      [SETTINGS]: () => json(brandSettings({ ticketDoneBy: 'cashier' })),
      'GET /api/v1/kitchen/tickets': () => json({ data: [ticket] }),
    });
    renderApp('/kds');

    const card = await screen.findByRole('article', { name: 'Order 4' });
    expect(await within(card).findByText('Ready')).toBeVisible();
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  });

  it('asks for the tickets of its station only, and shows it', async () => {
    saveTerminal({ ...mall, stationId: stations[1]?.id, stationName: stations[1]?.name });
    const api = mockApi({
      'POST /api/v1/auth/refresh': () => json(sessionFor(kitchenStaff)),
      [SETTINGS]: () => json(brandSettings({ kitchenStations: stations })),
      'GET /api/v1/kitchen/tickets': () => json({ data: [] }),
    });
    renderApp('/kds');

    expect(await screen.findByText('Nothing to make. New orders appear here.')).toBeVisible();
    expect(screen.getByText(/Drinks/)).toBeVisible();
    expect(
      api.calls
        .find((call) => call.key === 'GET /api/v1/kitchen/tickets')
        ?.url.searchParams.get('stationId'),
    ).toBe(stations[1]?.id);
  });

  it('is set up for a station when the brand has stations', async () => {
    mockApi({
      'POST /api/v1/auth/refresh': () => json(sessionFor(fullBrandManager)),
      'GET /api/v1/brands': () => json(page([pizzaBrand])),
      [`GET /api/v1/brands/${ids.pizza}/branches`]: () => json(page([pizzaMall])),
      [SETTINGS]: () => json(brandSettings({ kitchenStations: stations })),
      'POST /api/v1/auth/logout': () => new Response(null, { status: 204 }),
    });
    const user = userEvent.setup();
    renderApp('/pos/setup?next=/kds');

    await user.click(await screen.findByRole('radio', { name: /Mall Branch/ }));
    await user.selectOptions(
      await screen.findByLabelText('Kitchen station'),
      stations[0]?.id ?? '',
    );
    await user.click(screen.getByRole('button', { name: 'Use this branch' }));

    expect(await screen.findByLabelText('Staff code')).toBeVisible();
    expect(readTerminal()).toMatchObject({
      stationId: stations[0]?.id,
      stationName: stations[0]?.name,
    });
  });
});
