import { type Customer, defaultLoyaltySettings, type Order } from '@pos/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
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
import { order, orderIds, orderLine, orderSummary } from '../../test/order-fixtures';
import { renderApp } from '../../test/render-app';
import { Receipt } from './Receipt';
import { forgetTerminal, saveTerminal, type Terminal } from './terminal-store';

const LOOKUP = 'GET /api/v1/customers/lookup';
const CUSTOMER = `PUT /api/v1/orders/${orderIds.first}/customer`;
const NO_CUSTOMER = `DELETE /api/v1/orders/${orderIds.first}/customer`;
const POINTS = `PUT /api/v1/orders/${orderIds.first}/points`;
const NO_POINTS = `DELETE /api/v1/orders/${orderIds.first}/points`;

afterEach(() => {
  forgetTerminal();
});

const terminal: Terminal = {
  branchId: ids.pizzaMall,
  brandId: ids.pizza,
  branchName: pizzaMall.name,
  brandName: pizzaBrand.name,
};

// An open order of two dishes at 5.000.
const open = order({
  lines: [orderLine({ quantity: 2, lineTotal: '10.000' })],
  subtotal: '10.000',
  total: '10.000',
});

const sara: Customer = {
  id: '01990000-0000-7000-8000-00000000c001',
  brandId: ids.pizza,
  phone: '+96555550000',
  name: 'Sara',
  email: null,
  notes: null,
  points: 300,
  visits: 4,
  totalSpent: '41.500',
  lastVisitAt: '2026-10-10T18:00:00.000Z',
  createdAt: '2026-09-01T18:00:00.000Z',
};
const onOrder = { id: sara.id, name: sara.name, phone: sara.phone, points: sara.points };
const withSara: Order = { ...open, customer: onOrder };
const spent: Order = { ...withSara, pointsRedeemed: 200, pointsDiscount: '2.000', total: '8.000' };

// A point worth 10 fils keeps the arithmetic of this test simple.
const loyaltyOn = brandSettings({
  loyalty: { ...defaultLoyaltySettings, enabled: true, pointValue: '0.010' },
});

// The order as the server has it now: what a write answers is what GET answers next.
let current: Order = open;

function posApi(handlers: Record<string, MockHandler> = {}, settings = loyaltyOn) {
  current = open;
  saveTerminal(terminal);
  const remembered = Object.fromEntries(
    Object.entries(handlers).map(([key, handler]) => [
      key,
      async (request: Parameters<MockHandler>[0]) => {
        const response = await handler(request);
        if (response.ok && key !== LOOKUP) current = (await response.clone().json()) as Order;
        return response;
      },
    ]),
  );
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(fullCashier)),
    'GET /api/v1/menu': () => json(branchMenu()),
    [`GET /api/v1/brands/${ids.pizza}/settings`]: () => json(settings),
    'GET /api/v1/shifts/current': () => json(shiftSummary()),
    'GET /api/v1/orders': () => json(page([orderSummary(current)])),
    [`GET /api/v1/orders/${orderIds.first}`]: () => json(current),
    ...remembered,
  });
}

async function openTheOrder(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Open orders' }));
  await user.click(await screen.findByRole('button', { name: /Order 1/ }));
  const panel = screen.getByRole('region', { name: 'Order' });
  await within(panel).findByTestId('order-total');
  return panel;
}

describe('a customer on the POS', () => {
  it('is added by phone when the phone is new, with a name', async () => {
    const api = posApi({
      [LOOKUP]: () => errorResponse(404, 'NOT_FOUND'),
      [CUSTOMER]: ({ body }) =>
        json({
          ...open,
          customer: { id: sara.id, name: 'Noor', phone: (body as Customer).phone, points: 0 },
        }),
    });
    const user = userEvent.setup();
    renderApp('/pos');

    const panel = await openTheOrder(user);
    await user.click(within(panel).getByRole('button', { name: 'Customer' }));
    const dialog = screen.getByRole('dialog', { name: 'Customer' });
    await user.type(within(dialog).getByLabelText('Phone number'), '1234');
    await user.click(within(dialog).getByRole('button', { name: 'Find' }));
    expect(within(dialog).getByLabelText('Phone number')).toHaveAccessibleDescription(
      /Eight digits are a Kuwaiti number\. Type a whole phone number/,
    );
    expect(api.count(LOOKUP)).toBe(0);

    await user.clear(within(dialog).getByLabelText('Phone number'));
    await user.type(within(dialog).getByLabelText('Phone number'), '5555 0000');
    await user.click(within(dialog).getByRole('button', { name: 'Find' }));
    expect(await within(dialog).findByText('+96555550000')).toBeVisible();
    expect(api.calls.find((call) => call.key === LOOKUP)?.url.searchParams.get('phone')).toBe(
      '+96555550000',
    );
    await user.type(within(dialog).getByLabelText('Name'), 'Noor');
    await user.click(within(dialog).getByRole('button', { name: 'Add to the order' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.calls.find((call) => call.key === CUSTOMER)?.body).toEqual({
      phone: '+96555550000',
      name: 'Noor',
    });
    const customer = within(panel).getByTestId('order-customer');
    expect(customer).toHaveTextContent('Noor');
    expect(customer).toHaveTextContent('0 points');
    // Too few points to spend any.
    expect(within(panel).queryByRole('button', { name: 'Use points' })).not.toBeInTheDocument();
  });

  it('is put on the order at once when found, spends points, and is taken off', async () => {
    const api = posApi({
      [LOOKUP]: () => json(sara),
      [CUSTOMER]: () => json(withSara),
      [POINTS]: () => json(spent),
      [NO_POINTS]: () => json(withSara),
      [NO_CUSTOMER]: () => json(open),
    });
    const user = userEvent.setup();
    renderApp('/pos');

    const panel = await openTheOrder(user);
    await user.click(within(panel).getByRole('button', { name: 'Customer' }));
    const dialog = screen.getByRole('dialog', { name: 'Customer' });
    await user.type(within(dialog).getByLabelText('Phone number'), '+965 5555-0000');
    await user.click(within(dialog).getByRole('button', { name: 'Find' }));
    await within(panel).findByText('Sara');
    expect(api.calls.find((call) => call.key === CUSTOMER)?.body).toEqual({
      phone: '+96555550000',
    });
    expect(within(panel).getByTestId('order-customer')).toHaveTextContent('300 points');

    await user.click(within(panel).getByRole('button', { name: 'Use points' }));
    const points = screen.getByRole('dialog', { name: 'Use points' });
    expect(points).toHaveTextContent(
      'The customer has 300 points. (from 100 to 300 on this order)',
    );
    expect(within(points).getByLabelText('Points to spend')).toHaveValue('300');
    await user.clear(within(points).getByLabelText('Points to spend'));
    await user.type(within(points).getByLabelText('Points to spend'), '50');
    await user.click(within(points).getByRole('button', { name: 'Use' }));
    expect(within(points).getByLabelText('Points to spend')).toHaveAccessibleDescription(
      'That is fewer points than can be spent at once.',
    );
    await user.clear(within(points).getByLabelText('Points to spend'));
    await user.type(within(points).getByLabelText('Points to spend'), '200');
    expect(within(points).getByTestId('points-worth')).toHaveTextContent('2.000 KWD');
    await user.click(within(points).getByRole('button', { name: 'Use' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.calls.filter((call) => call.key === POINTS).map((call) => call.body)).toEqual([
      { points: 200 },
    ]);
    expect(within(panel).getByText('Points (200)').closest('div')).toHaveTextContent('− 2.000 KWD');
    expect(within(panel).getByTestId('order-total')).toHaveTextContent('8.000');

    await user.click(within(panel).getByRole('button', { name: 'Spend no points' }));
    await within(panel).findByRole('button', { name: 'Use points' });
    await user.click(
      within(panel).getByRole('button', { name: 'Take the customer off the order' }),
    );
    expect(await within(panel).findByRole('button', { name: 'Customer' })).toBeVisible();
    expect(api.count(NO_CUSTOMER)).toBe(1);
  });

  it('shows no way to spend points when loyalty is off', async () => {
    posApi({ [LOOKUP]: () => json(sara), [CUSTOMER]: () => json(withSara) }, brandSettings());
    const user = userEvent.setup();
    renderApp('/pos');

    const panel = await openTheOrder(user);
    await user.click(within(panel).getByRole('button', { name: 'Customer' }));
    const dialog = screen.getByRole('dialog', { name: 'Customer' });
    await user.type(within(dialog).getByLabelText('Phone number'), '55550000');
    await user.click(within(dialog).getByRole('button', { name: 'Find' }));
    await within(panel).findByText('Sara');
    expect(within(panel).queryByRole('button', { name: 'Use points' })).not.toBeInTheDocument();
  });
});

describe('the receipt', () => {
  it('shows the customer, the points spent and the points earned', () => {
    const paid: Order = {
      ...spent,
      status: 'paid',
      paidAt: '2026-10-13T09:30:00.000Z',
      pointsEarned: 8,
      customer: { ...onOrder, points: 108 },
    };
    render(<Receipt order={paid} terminal={terminal} cashier="Sara Cashier" />);

    const receipt = screen.getByTestId('receipt');
    expect(receipt).toHaveTextContent('Customer: Sara +96555550000');
    expect(screen.getByText('Points (200)').closest('div')).toHaveTextContent('− 2.000 KWD');
    expect(screen.getByText('Points earned').closest('div')).toHaveTextContent('8 points');
    expect(screen.getByText('Points balance').closest('div')).toHaveTextContent('108 points');
  });
});
