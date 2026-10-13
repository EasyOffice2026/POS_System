import type { Order } from '@pos/shared';
import { screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  brandSettings,
  shiftSummary,
  fullCashier,
  ids,
  page,
  pizzaBrand,
  pizzaMall,
  sessionFor,
} from '../../test/fixtures';
import { branchMenu } from '../../test/menu-fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { order, orderIds, orderLine, orderSummary } from '../../test/order-fixtures';
import { renderApp } from '../../test/render-app';
import { forgetTerminal, saveTerminal } from './terminal-store';

const PAY = `POST /api/v1/orders/${orderIds.first}/pay`;
const GET_FIRST = `GET /api/v1/orders/${orderIds.first}`;
const cashId = '01990000-0000-7000-8000-000000000901';
const cardId = '01990000-0000-7000-8000-000000000902';

afterEach(() => {
  forgetTerminal();
});

// An open order of 72.000: two lines and a 10% discount.
const due72 = order({
  lines: [
    orderLine({ quantity: 10, lineTotal: '50.000' }),
    orderLine({
      id: '01990000-0000-7000-8000-000000000803',
      name: { en: 'Garlic bread', ar: 'خبز بالثوم' },
      unitPrice: '30.000',
      lineTotal: '30.000',
    }),
  ],
  subtotal: '80.000',
  discount: { kind: 'percent', value: '10.00', amount: '8.000', reason: 'Regular' },
  total: '72.000',
});

const paid = (overrides: Partial<Order>): Order => ({
  ...due72,
  status: 'paid',
  paidAt: '2026-10-13T09:30:00.000Z',
  paidById: fullCashier.id,
  ...overrides,
});

function payApi(pay: MockHandler, current: () => Order = () => due72) {
  saveTerminal({
    branchId: ids.pizzaMall,
    brandId: ids.pizza,
    branchName: pizzaMall.name,
    brandName: pizzaBrand.name,
  });
  // The dialog makes the id of the cash part first, then the card part.
  vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(cashId).mockReturnValueOnce(cardId);
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(fullCashier)),
    'GET /api/v1/menu': () => json(branchMenu()),
    'GET /api/v1/shifts/current': () => json(shiftSummary()),
    [`GET /api/v1/brands/${ids.pizza}/settings`]: () =>
      json(
        brandSettings({
          paymentMethods: [
            { key: 'knet', name: { en: 'KNET', ar: 'كي نت' }, isActive: true },
            { key: 'link', name: { en: 'Link', ar: 'لينك' }, isActive: true },
          ],
        }),
      ),
    'GET /api/v1/orders': () => json(page([orderSummary(due72)])),
    [GET_FIRST]: () => json(current()),
    [PAY]: pay,
  });
}

async function openPayment(user: UserEvent) {
  await user.click(await screen.findByRole('button', { name: 'Open orders' }));
  await user.click(await screen.findByRole('button', { name: /Order 1/ }));
  await user.click(await screen.findByRole('button', { name: /^Pay/ }));
  return screen.getByRole('dialog', { name: 'Pay order 1' });
}

describe('paying an order', () => {
  it('takes cash, shows the change, and prints a receipt (criterion 1)', async () => {
    const api = payApi(() =>
      json(
        paid({
          change: '28.000',
          payments: [
            {
              id: cashId,
              method: 'cash',
              methodName: { en: 'Cash', ar: 'نقدًا' },
              amount: '72.000',
              tendered: '100.000',
              change: '28.000',
              reference: null,
              takenById: fullCashier.id,
              createdAt: '2026-10-13T09:30:00.000Z',
            },
          ],
        }),
      ),
    );
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderApp('/pos');

    const dialog = await openPayment(user);
    expect(within(dialog).getByTestId('amount-due')).toHaveTextContent('72.000');
    const confirm = within(dialog).getByRole('button', { name: 'Confirm payment' });
    expect(confirm).toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: '100' }));
    expect(within(dialog).getByTestId('change-due')).toHaveTextContent('28.000');
    await user.click(confirm);

    const receipt = await screen.findByRole('dialog', { name: 'Receipt' });
    expect(within(receipt).getByText('Pizza Palace - Mall Branch')).toBeVisible();
    expect(within(receipt).getByText('Cashier: Mall Branch Cashier')).toBeVisible();
    expect(within(receipt).getByText('Cash').nextElementSibling).toHaveTextContent('100.000');
    expect(within(receipt).getByText('Change').nextElementSibling).toHaveTextContent('28.000');

    await user.click(within(receipt).getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalled();
    await user.click(within(receipt).getByRole('button', { name: 'New order' }));
    expect(await screen.findByRole('heading', { name: 'New order' })).toBeVisible();

    expect(api.calls.find((call) => call.key === PAY)?.body).toEqual({
      tenders: [{ id: cashId, method: 'cash', amount: '72.000', tendered: '100.000' }],
    });
  });

  it('splits between a card and cash (criterion 2)', async () => {
    const api = payApi(() => json(paid({})));
    const user = userEvent.setup();
    renderApp('/pos');

    const dialog = await openPayment(user);
    await user.click(within(dialog).getByRole('button', { name: 'Mixed' }));
    await user.type(within(dialog).getByLabelText('Amount by KNET'), '50');
    await user.type(within(dialog).getByLabelText('Reference number (optional)'), '4821');
    await user.click(within(dialog).getByRole('button', { name: 'Exact' }));
    expect(within(dialog).getByTestId('change-due')).toHaveTextContent('0.000');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm payment' }));

    expect(await screen.findByRole('dialog', { name: 'Receipt' })).toBeVisible();
    expect(api.calls.find((call) => call.key === PAY)?.body).toEqual({
      tenders: [
        { id: cardId, method: 'knet', amount: '50.000', reference: '4821' },
        { id: cashId, method: 'cash', amount: '22.000', tendered: '22.000' },
      ],
    });
  });

  it('pays by card alone', async () => {
    const api = payApi(() => json(paid({})));
    const user = userEvent.setup();
    renderApp('/pos');

    const dialog = await openPayment(user);
    await user.click(within(dialog).getByRole('button', { name: 'KNET' }));
    expect(within(dialog).queryByTestId('change-due')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm payment' }));

    expect(await screen.findByRole('dialog', { name: 'Receipt' })).toBeVisible();
    expect(api.calls.find((call) => call.key === PAY)?.body).toEqual({
      tenders: [{ id: cardId, method: 'knet', amount: '72.000' }],
    });
  });

  it('says so when the total changed on another terminal, and loads the order again', async () => {
    let total = '72.000';
    const api = payApi(
      () => {
        total = '77.000';
        return errorResponse(400, 'VALIDATION_ERROR', [
          { path: 'tenders', message: 'PAYMENT_TOTAL_MISMATCH' },
        ]);
      },
      () => ({ ...due72, total }),
    );
    const user = userEvent.setup();
    renderApp('/pos');

    const dialog = await openPayment(user);
    await user.click(within(dialog).getByRole('button', { name: 'Exact' }));
    await user.click(within(dialog).getByRole('button', { name: 'Confirm payment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The total of the order changed.');
    expect(await screen.findByRole('button', { name: /^Pay 77\.000/ })).toBeVisible();
    expect(api.count(GET_FIRST)).toBeGreaterThan(1);
  });
});
