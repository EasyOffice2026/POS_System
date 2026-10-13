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
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { order, orderIds, orderLine, orderSummary } from '../../test/order-fixtures';
import { renderApp } from '../../test/render-app';
import { forgetTerminal, saveTerminal } from './terminal-store';

const REFUND = `POST /api/v1/orders/${orderIds.first}/refunds`;
const refundId = '01990000-0000-7000-8000-00000000f001';

afterEach(() => {
  forgetTerminal();
});

// An order of 25.000 paid 20.000 by KNET and 5.000 in cash.
const paidOrder = order({
  status: 'paid',
  paidAt: '2026-10-13T09:30:00.000Z',
  paidById: fullCashier.id,
  lines: [
    orderLine({
      quantity: 5,
      lineTotal: '25.000',
      status: 'sent',
      sentAt: '2026-10-13T09:29:00.000Z',
    }),
  ],
  subtotal: '25.000',
  total: '25.000',
  payments: [
    {
      id: '01990000-0000-7000-8000-000000000901',
      method: 'knet',
      methodName: { en: 'KNET', ar: 'كي نت' },
      amount: '20.000',
      tendered: null,
      change: '0.000',
      reference: null,
      takenById: fullCashier.id,
      createdAt: '2026-10-13T09:30:00.000Z',
    },
    {
      id: '01990000-0000-7000-8000-000000000902',
      method: 'cash',
      methodName: { en: 'Cash', ar: 'نقدًا' },
      amount: '5.000',
      tendered: '5.000',
      change: '0.000',
      reference: null,
      takenById: fullCashier.id,
      createdAt: '2026-10-13T09:30:00.000Z',
    },
  ],
});

function posApi(handlers: Record<string, MockHandler> = {}) {
  saveTerminal({
    branchId: ids.pizzaMall,
    brandId: ids.pizza,
    branchName: pizzaMall.name,
    brandName: pizzaBrand.name,
  });
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(refundId);
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(fullCashier)),
    'GET /api/v1/menu': () => json(branchMenu()),
    [`GET /api/v1/brands/${ids.pizza}/settings`]: () => json(brandSettings()),
    'GET /api/v1/shifts/current': () => json(shiftSummary()),
    'GET /api/v1/orders': (request) =>
      json(
        page(request.url.searchParams.get('status') === 'paid' ? [orderSummary(paidOrder)] : []),
      ),
    [`GET /api/v1/orders/${orderIds.first}`]: () => json(paidOrder),
    ...handlers,
  });
}

async function openPaidOrder(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Open orders' }));
  await user.click(await screen.findByRole('tab', { name: 'Paid' }));
  await user.click(await screen.findByRole('button', { name: /Order 1/ }));
  const panel = screen.getByRole('region', { name: 'Order' });
  await within(panel).findByText('Paid');
  return panel;
}

describe('refunds on the POS', () => {
  it('finds a paid order and gives part of it back by the way it was paid', async () => {
    const api = posApi({
      [REFUND]: () =>
        json({
          ...paidOrder,
          refunded: '10.000',
          refunds: [
            {
              id: refundId,
              amount: '10.000',
              method: 'knet',
              methodName: { en: 'KNET', ar: 'كي نت' },
              reason: 'Cold pizza',
              refundedById: fullCashier.id,
              approvedById: null,
              createdAt: '2026-10-13T10:00:00.000Z',
            },
          ],
        }),
    });
    const user = userEvent.setup();
    renderApp('/pos');

    const panel = await openPaidOrder(user);
    await user.click(within(panel).getByRole('button', { name: 'Refund' }));

    const dialog = screen.getByRole('dialog', { name: 'Refund order 1' });
    expect(within(dialog).getByTestId('refund-left')).toHaveTextContent('25.000');
    expect(within(dialog).getByLabelText('Amount to give back')).toHaveValue('25.000');
    const ways = within(dialog).getByLabelText('Given back');
    expect(
      within(ways)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Cash', 'KNET']);
    await user.clear(within(dialog).getByLabelText('Amount to give back'));
    await user.type(within(dialog).getByLabelText('Amount to give back'), '10');
    await user.selectOptions(ways, 'knet');
    await user.type(within(dialog).getByLabelText('Reason'), 'Cold pizza');
    await user.click(within(dialog).getByRole('button', { name: 'Give the refund' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Order 1: 10 given back.');
    expect(within(panel).getByText('Refunded').nextElementSibling).toHaveTextContent('10.000');
    expect(api.calls.find((call) => call.key === REFUND)?.body).toEqual({
      id: refundId,
      amount: '10',
      method: 'knet',
      reason: 'Cold pizza',
    });
  });

  it('refuses more than is left before sending, and asks a manager when the API does', async () => {
    let calls = 0;
    const api = posApi({
      [REFUND]: () => {
        calls += 1;
        return calls === 1
          ? errorResponse(400, 'VALIDATION_ERROR', [
              { path: 'approval', message: 'APPROVAL_REQUIRED' },
            ])
          : json({ ...paidOrder, refunded: '25.000' });
      },
    });
    const user = userEvent.setup();
    renderApp('/pos');

    const panel = await openPaidOrder(user);
    await user.click(within(panel).getByRole('button', { name: 'Refund' }));
    const dialog = screen.getByRole('dialog', { name: 'Refund order 1' });
    await user.clear(within(dialog).getByLabelText('Amount to give back'));
    await user.type(within(dialog).getByLabelText('Amount to give back'), '30');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('more than what is left');
    expect(within(dialog).getByRole('button', { name: 'Give the refund' })).toBeDisabled();

    await user.clear(within(dialog).getByLabelText('Amount to give back'));
    await user.type(within(dialog).getByLabelText('Amount to give back'), '25');
    await user.type(within(dialog).getByLabelText('Reason'), 'Wrong order');
    await user.click(within(dialog).getByRole('button', { name: 'Give the refund' }));

    const approval = await screen.findByRole('dialog', { name: 'A manager must approve' });
    await user.type(within(approval).getByLabelText('Staff code'), '1003');
    await user.type(within(approval).getByLabelText('PIN'), '5824');
    await user.click(within(approval).getByRole('button', { name: 'Approve' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Order 1: 25 given back.');
    expect(api.calls.filter((call) => call.key === REFUND).map((call) => call.body)).toEqual([
      { id: refundId, amount: '25', method: 'cash', reason: 'Wrong order' },
      {
        id: refundId,
        amount: '25',
        method: 'cash',
        reason: 'Wrong order',
        approval: { staffCode: '1003', pin: '5824' },
      },
    ]);
    expect(within(panel).getByRole('button', { name: 'Refund' })).toBeDisabled();
  });
});
