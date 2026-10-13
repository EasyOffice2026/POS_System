import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import {
  brandSettings,
  branchManager,
  brandManager,
  fullCashier,
  ids,
  page,
  pizzaBrand,
  pizzaDowntown,
  pizzaMall,
  sessionFor,
  shiftSummary,
} from '../../test/fixtures';
import { branchMenu } from '../../test/menu-fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';
import { forgetTerminal, saveTerminal } from '../pos/terminal-store';

const CURRENT = 'GET /api/v1/shifts/current';
const OPEN = 'POST /api/v1/shifts';
const shiftId = '01990000-0000-7000-8000-00000000e001';
const CLOSE = `POST /api/v1/shifts/${shiftId}/close`;

afterEach(() => {
  forgetTerminal();
});

function posApi(handlers: Record<string, MockHandler> = {}) {
  saveTerminal({
    branchId: ids.pizzaMall,
    brandId: ids.pizza,
    branchName: pizzaMall.name,
    brandName: pizzaBrand.name,
  });
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(fullCashier)),
    'GET /api/v1/menu': () => json(branchMenu()),
    [`GET /api/v1/brands/${ids.pizza}/settings`]: () => json(brandSettings()),
    ...handlers,
  });
}

const closedReport = () => ({
  ...shiftSummary({
    status: 'closed',
    closedById: fullCashier.id,
    closedByName: fullCashier.name,
    closedAt: '2026-10-13T14:00:00.000Z',
    countedCash: '74.500',
    expectedCash: '75.000',
    difference: '-0.500',
    figures: {
      ordersPaid: 3,
      sales: '40.000',
      discounts: '2.000',
      byMethod: [
        { method: 'cash', methodName: { en: 'Cash', ar: 'نقدًا' }, amount: '25.000' },
        { method: 'knet', methodName: { en: 'KNET', ar: 'كي نت' }, amount: '15.000' },
      ],
      cashExpected: '75.000',
    },
  }),
  voids: { orders: 1, ordersValue: '5.000', lines: 0, linesValue: '0.000' },
});

describe('the shift on the POS', () => {
  it('asks for the cash in the drawer when the cashier has no open shift', async () => {
    let opened = false;
    const api = posApi({
      [CURRENT]: () => json(opened ? shiftSummary() : null),
      [OPEN]: () => {
        opened = true;
        return json(shiftSummary(), 201);
      },
    });
    const user = userEvent.setup();
    renderApp('/pos');

    expect(await screen.findByRole('heading', { name: 'Open your shift' })).toBeVisible();
    await user.type(screen.getByLabelText('Cash in the drawer at opening'), '50');
    await user.click(screen.getByRole('button', { name: 'Open the shift' }));

    expect(await screen.findByRole('region', { name: 'Menu' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Close shift' })).toBeVisible();
    expect(api.calls.find((call) => call.key === OPEN)?.body).toEqual({
      branchId: ids.pizzaMall,
      openingCash: '50',
    });
  });

  it('shows the API’s answer when the shift cannot be opened', async () => {
    posApi({
      [CURRENT]: () => json(null),
      [OPEN]: () => errorResponse(409, 'SHIFT_ALREADY_OPEN'),
    });
    const user = userEvent.setup();
    renderApp('/pos');

    await user.type(await screen.findByLabelText('Cash in the drawer at opening'), '50');
    await user.click(screen.getByRole('button', { name: 'Open the shift' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You already have an open shift at this branch.',
    );
  });

  it('closes the shift with the count, shows the report, then asks for a new shift', async () => {
    let closed = false;
    const api = posApi({
      [CURRENT]: () => json(closed ? null : shiftSummary()),
      [CLOSE]: () => {
        closed = true;
        return json(closedReport());
      },
    });
    const user = userEvent.setup();
    renderApp('/pos');

    await user.click(await screen.findByRole('button', { name: 'Close shift' }));
    const dialog = screen.getByRole('dialog', { name: 'Close shift' });
    expect(within(dialog).getByTestId('cash-expected')).toHaveTextContent('50.000');
    await user.type(within(dialog).getByLabelText('Cash counted'), '74.5');
    await user.type(within(dialog).getByLabelText('Note'), 'Coins short');
    await user.click(within(dialog).getByRole('button', { name: 'Close the shift' }));

    const report = await screen.findByRole('dialog', { name: 'Shift report' });
    expect(within(report).getByTestId('difference')).toHaveTextContent('-0.500');
    expect(within(report).getByTestId('difference').parentElement).toHaveClass('text-red-700');
    expect(within(report).getByText('KNET').nextElementSibling).toHaveTextContent('15.000');
    expect(within(report).getByText('1 order voided')).toBeVisible();
    expect(api.calls.find((call) => call.key === CLOSE)?.body).toEqual({
      countedCash: '74.5',
      note: 'Coins short',
    });

    await user.click(within(report).getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('heading', { name: 'Open your shift' })).toBeVisible();
  });
});

describe('the Shifts page', () => {
  function adminApi(user = branchManager, handlers: Record<string, MockHandler> = {}) {
    return mockApi({
      'POST /api/v1/auth/refresh': () => json(sessionFor(user)),
      'GET /api/v1/brands': () => json(page([pizzaBrand])),
      [`GET /api/v1/brands/${ids.pizza}/branches`]: () => json(page([pizzaMall, pizzaDowntown])),
      'GET /api/v1/shifts': () =>
        json(
          page([shiftSummary(), { ...closedReport(), id: '01990000-0000-7000-8000-00000000e002' }]),
        ),
      ...handlers,
    });
  }
  const manager = {
    ...branchManager,
    permissions: [...branchManager.permissions, 'shifts:read' as const, 'orders:write' as const],
  };

  it('lists the shifts of the branch with their figures, and opens a report', async () => {
    const api = adminApi(manager, {
      [`GET /api/v1/shifts/01990000-0000-7000-8000-00000000e002`]: () => json(closedReport()),
    });
    const user = userEvent.setup();
    renderApp('/admin/shifts');

    const rows = await screen.findAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1] as HTMLElement).getByText('Open')).toBeVisible();
    expect(
      within(rows[2] as HTMLElement)
        .getByText('-0.500')
        .closest('td'),
    ).toHaveClass('text-red-700');
    expect(
      api.calls.find((call) => call.key === 'GET /api/v1/shifts')?.url.searchParams.get('branchId'),
    ).toBe(ids.pizzaMall);

    await user.click(within(rows[2] as HTMLElement).getByRole('button', { name: /Shift report/ }));
    const report = await screen.findByRole('dialog', { name: 'Shift report' });
    expect(await within(report).findByText('1 order voided')).toBeVisible();
  });

  it('lets a manager close a cashier’s open shift', async () => {
    const api = adminApi(manager, { [CLOSE]: () => json(closedReport()) });
    const user = userEvent.setup();
    renderApp('/admin/shifts');

    const rows = await screen.findAllByRole('row');
    await user.click(within(rows[1] as HTMLElement).getByRole('button', { name: /Close shift/ }));
    const dialog = screen.getByRole('dialog', { name: 'Close shift' });
    await user.type(within(dialog).getByLabelText('Cash counted'), '75');
    await user.click(within(dialog).getByRole('button', { name: 'Close the shift' }));

    expect(await screen.findByRole('dialog', { name: 'Shift report' })).toBeVisible();
    expect(api.calls.find((call) => call.key === CLOSE)?.body).toEqual({ countedCash: '75' });
  });

  it('is not offered to a cashier, and shows no Close button to a person who takes no payments', async () => {
    adminApi({ ...brandManager, permissions: ['brands:read', 'branches:read', 'shifts:read'] });
    renderApp('/admin/shifts');

    const rows = await screen.findAllByRole('row');
    expect(
      within(rows[1] as HTMLElement).queryByRole('button', { name: /Close shift/ }),
    ).not.toBeInTheDocument();
  });
});
