import type { BranchMenu, DeliveryDetails } from '@pos/shared';
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
import { errorResponse, json, mockApi } from '../../test/mock-api';
import { lineIds, order, orderIds, orderLine, orderSummary } from '../../test/order-fixtures';
import { renderApp } from '../../test/render-app';
import { forgetTerminal, saveTerminal } from './terminal-store';

type Uuid = ReturnType<typeof crypto.randomUUID>;

const CREATE = 'POST /api/v1/orders';
const LINES = `POST /api/v1/orders/${orderIds.first}/lines`;
const SEND = `POST /api/v1/orders/${orderIds.first}/send`;
const PATCH = `PATCH /api/v1/orders/${orderIds.first}`;

afterEach(() => {
  forgetTerminal();
});

const details: DeliveryDetails = {
  name: null,
  phone: '+965 5555 1234',
  address: 'Block 4, Street 12, House 7',
  note: null,
};

function posApi(
  orderTypes: BranchMenu['orderTypes'],
  handlers: Parameters<typeof mockApi>[0] = {},
) {
  saveTerminal({
    branchId: ids.pizzaMall,
    brandId: ids.pizza,
    branchName: pizzaMall.name,
    brandName: pizzaBrand.name,
  });
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(fullCashier)),
    'GET /api/v1/menu': () => json(branchMenu({ orderTypes })),
    [`GET /api/v1/brands/${ids.pizza}/settings`]: () => json(brandSettings()),
    'GET /api/v1/shifts/current': () => json(shiftSummary()),
    ...handlers,
  });
}

const panel = () => screen.getByRole('region', { name: 'Order' });

describe('the order types a branch offers (spec 026)', () => {
  it('shows Dine-in and Takeaway with the Tables button, as before', async () => {
    posApi(['dine_in', 'takeaway']);
    renderApp('/pos');

    expect(await screen.findByRole('button', { name: 'Tables' })).toBeVisible();
    expect(within(panel()).getByRole('button', { name: 'Dine-in' })).toBeVisible();
    expect(within(panel()).getByRole('button', { name: 'Takeaway' })).toBeVisible();
    expect(within(panel()).queryByRole('button', { name: 'Delivery' })).not.toBeInTheDocument();
  });

  it('shows no Tables button and no Dine-in at a kiosk, and starts with the first type', async () => {
    posApi(['takeaway', 'delivery']);
    renderApp('/pos');

    await screen.findByRole('tab', { name: /Pizzas/ });
    expect(screen.queryByRole('button', { name: 'Tables' })).not.toBeInTheDocument();
    expect(within(panel()).queryByRole('button', { name: 'Dine-in' })).not.toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: 'Takeaway' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(panel()).getByRole('button', { name: 'Delivery' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('has nothing to choose at a branch with one type', async () => {
    posApi(['takeaway']);
    renderApp('/pos');

    await screen.findByRole('tab', { name: /Pizzas/ });
    expect(within(panel()).queryByRole('button', { name: 'Takeaway' })).not.toBeInTheDocument();
  });
});

describe('delivery orders on the POS (spec 026)', () => {
  it('asks for the phone and the address, and opens the order with them', async () => {
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce(orderIds.first as Uuid)
      .mockReturnValueOnce(lineIds.cola as Uuid);
    const onWay = order({ type: 'delivery', delivery: details });
    const api = posApi(['dine_in', 'takeaway', 'delivery'], {
      [CREATE]: () => json(onWay, 201),
      [LINES]: () => json({ ...onWay, lines: [orderLine()], subtotal: '5.000', total: '5.000' }),
    });
    const user = userEvent.setup();
    renderApp('/pos');

    await user.click(await within(await screenPanel()).findByRole('button', { name: 'Delivery' }));
    await user.click(within(panel()).getByRole('button', { name: 'Add delivery details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delivery details' });

    // The address is needed.
    await user.type(within(dialog).getByLabelText("Customer's phone"), '+965 5555 1234');
    await user.click(within(dialog).getByRole('button', { name: 'Save details' }));
    expect(await within(dialog).findByText('Type the address.')).toBeVisible();

    await user.type(within(dialog).getByLabelText('Address'), details.address);
    await user.click(within(dialog).getByRole('button', { name: 'Save details' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(panel()).getByTestId('order-delivery')).toHaveTextContent(details.address);

    await user.click(screen.getByRole('tab', { name: 'Drinks' }));
    await user.click(screen.getByRole('button', { name: /Cola/ }));
    await within(panel()).findByText('Cola');
    expect(api.calls.find((call) => call.key === CREATE)?.body).toEqual({
      id: orderIds.first,
      branchId: ids.pizzaMall,
      type: 'delivery',
      delivery: details,
    });
  });

  it('opens the box instead of sending a delivery order that has no address yet', async () => {
    const bare = order({
      type: 'delivery',
      lines: [orderLine({ status: 'pending' })],
      subtotal: '5.000',
      total: '5.000',
    });
    const api = posApi(['takeaway', 'delivery'], {
      'GET /api/v1/orders': () => json(page([orderSummary(bare)])),
      [`GET /api/v1/orders/${orderIds.first}`]: () => json(bare),
      [SEND]: () => json(bare),
      [PATCH]: () => json({ ...bare, delivery: details }),
    });
    const user = userEvent.setup();
    renderApp('/pos');
    await screen.findByRole('tab', { name: /Pizzas/ });

    await user.click(screen.getByRole('button', { name: 'Open orders' }));
    await user.click(await screen.findByRole('button', { name: /Order 1/ }));
    await within(panel()).findByText('Cola');
    await user.click(within(panel()).getByRole('button', { name: 'Send 1 item to kitchen' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delivery details' });
    expect(api.calls.some((call) => call.key === SEND)).toBe(false);

    await user.type(within(dialog).getByLabelText("Customer's phone"), details.phone);
    await user.type(within(dialog).getByLabelText('Address'), details.address);
    await user.click(within(dialog).getByRole('button', { name: 'Save details' }));
    expect(api.calls.find((call) => call.key === PATCH)?.body).toEqual({ delivery: details });
    expect(await within(panel()).findByTestId('order-delivery')).toHaveTextContent(details.address);
  });

  it('says so when the branch switched the type off meanwhile', async () => {
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce(orderIds.first as Uuid)
      .mockReturnValueOnce(lineIds.cola as Uuid);
    posApi(['takeaway', 'delivery'], {
      [CREATE]: () => errorResponse(409, 'ORDER_TYPE_NOT_OFFERED'),
    });
    const user = userEvent.setup();
    renderApp('/pos');

    await screen.findByRole('tab', { name: /Pizzas/ });
    await user.click(screen.getByRole('tab', { name: 'Drinks' }));
    await user.click(screen.getByRole('button', { name: /Cola/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This branch no longer takes this type of order',
    );
  });
});

const screenPanel = async () => {
  await screen.findByRole('tab', { name: /Pizzas/ });
  return panel();
};
