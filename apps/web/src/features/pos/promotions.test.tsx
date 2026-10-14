import type { Order } from '@pos/shared';
import { screen, within } from '@testing-library/react';
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
import { forgetTerminal, saveTerminal } from './terminal-store';

const PROMO = `PUT /api/v1/orders/${orderIds.first}/promo-code`;
const NO_PROMO = `DELETE /api/v1/orders/${orderIds.first}/promo-code`;

afterEach(() => {
  forgetTerminal();
});

// An open order of two dishes at 5.000.
const open = order({
  lines: [orderLine({ quantity: 2, lineTotal: '10.000' })],
  subtotal: '10.000',
  total: '10.000',
});

const withCode: Order = {
  ...open,
  promoCode: 'WELCOME',
  promotionDiscount: '1.000',
  promotions: [
    {
      id: '01990000-0000-7000-8000-00000000f001',
      name: { en: 'Welcome', ar: 'أهلًا' },
      amount: '1.000',
    },
  ],
  total: '9.000',
};

// The order as the server has it now: what a write answers is what GET answers next.
let current: Order = open;

function posApi(handlers: Record<string, MockHandler> = {}) {
  current = open;
  saveTerminal({
    branchId: ids.pizzaMall,
    brandId: ids.pizza,
    branchName: pizzaMall.name,
    brandName: pizzaBrand.name,
  });
  const remembered = Object.fromEntries(
    Object.entries(handlers).map(([key, handler]) => [
      key,
      async (request: Parameters<MockHandler>[0]) => {
        const response = await handler(request);
        if (response.ok) current = (await response.clone().json()) as Order;
        return response;
      },
    ]),
  );
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(fullCashier)),
    'GET /api/v1/menu': () => json(branchMenu()),
    [`GET /api/v1/brands/${ids.pizza}/settings`]: () => json(brandSettings()),
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

describe('promotions on the POS', () => {
  it('take a code the customer gives, show what it took off, and remove it', async () => {
    const api = posApi({
      [PROMO]: ({ body }) =>
        (body as { code: string }).code === 'WELCOME'
          ? json(withCode)
          : errorResponse(400, 'VALIDATION_ERROR', [
              { path: 'code', message: 'PROMO_CODE_INVALID' },
            ]),
      [NO_PROMO]: () => json(open),
    });
    const user = userEvent.setup();
    renderApp('/pos');

    const panel = await openTheOrder(user);
    await user.click(within(panel).getByRole('button', { name: 'Promo code' }));
    const dialog = screen.getByRole('dialog', { name: 'Promotion code' });
    await user.type(within(dialog).getByLabelText('Code'), 'nope1');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(await within(dialog).findByText('This code is not valid here today.')).toBeVisible();

    await user.clear(within(dialog).getByLabelText('Code'));
    await user.type(within(dialog).getByLabelText('Code'), 'welcome');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.calls.filter((call) => call.key === PROMO).map((call) => call.body)).toEqual([
      { code: 'NOPE1' },
      { code: 'WELCOME' },
    ]);
    expect(within(panel).getByText('Welcome').closest('div')).toHaveTextContent('− 1.000 KWD');
    expect(within(panel).getByText('WELCOME')).toBeVisible();
    expect(within(panel).getByTestId('order-total')).toHaveTextContent('9.000');

    await user.click(within(panel).getByRole('button', { name: 'Remove the code WELCOME' }));
    await waitForTotal(panel, '10.000');
    expect(within(panel).queryByText('Welcome')).not.toBeInTheDocument();
  });

  it('refuses a code that is too short before asking the server', async () => {
    const api = posApi();
    const user = userEvent.setup();
    renderApp('/pos');

    const panel = await openTheOrder(user);
    await user.click(within(panel).getByRole('button', { name: 'Promo code' }));
    const dialog = screen.getByRole('dialog', { name: 'Promotion code' });
    await user.type(within(dialog).getByLabelText('Code'), 'ab');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(within(dialog).getByLabelText('Code')).toHaveAccessibleDescription(
      'This code is not valid here today.',
    );
    expect(api.count(PROMO)).toBe(0);
  });
});

async function waitForTotal(panel: HTMLElement, total: string) {
  await within(panel).findByText((_, element) => {
    return (
      element?.getAttribute('data-testid') === 'order-total' &&
      element.textContent?.includes(total) === true
    );
  });
}
