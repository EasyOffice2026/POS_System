import { screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fullBrandManager,
  fullCashier,
  groupAdmin,
  ids,
  kitchenStaff,
  page,
  pizzaBrand,
  pizzaDowntown,
  pizzaMall,
  sessionFor,
} from '../../test/fixtures';
import { branchMenu, itemIds, modifierIds } from '../../test/menu-fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { lineIds, order, orderIds, orderLine, orderSummary } from '../../test/order-fixtures';
import { renderApp } from '../../test/render-app';
import { forgetTerminal, readTerminal, saveTerminal } from './terminal-store';

const REFRESH = 'POST /api/v1/auth/refresh';
const LOGIN = 'POST /api/v1/auth/login';
const LOGOUT = 'POST /api/v1/auth/logout';
const MENU = 'GET /api/v1/menu';
const CREATE = 'POST /api/v1/orders';
const OPEN = 'GET /api/v1/orders';
const LINES = `POST /api/v1/orders/${orderIds.first}/lines`;
const SEND = `POST /api/v1/orders/${orderIds.first}/send`;
const VOID_COLA = `POST /api/v1/orders/${orderIds.first}/lines/${lineIds.cola}/void`;
const GET_FIRST = `GET /api/v1/orders/${orderIds.first}`;

const mall = {
  branchId: ids.pizzaMall,
  brandId: ids.pizza,
  branchName: pizzaMall.name,
  brandName: pizzaBrand.name,
};

afterEach(() => {
  forgetTerminal();
});

const anonymous: MockHandler = () => errorResponse(401, 'UNAUTHENTICATED');

function terminalApi(handlers: Record<string, MockHandler> = {}) {
  return mockApi({
    [REFRESH]: () => json(sessionFor(fullCashier)),
    [MENU]: () => json(branchMenu()),
    ...handlers,
  });
}

// The ids the terminal makes for the order and its lines, in the order it makes them.
function nextIds(...values: string[]) {
  const spy = vi.spyOn(crypto, 'randomUUID');
  for (const value of values)
    spy.mockReturnValueOnce(value as ReturnType<typeof crypto.randomUUID>);
}

const colaOrder = (overrides = {}) =>
  order({ lines: [orderLine()], subtotal: '5.000', total: '5.000', ...overrides });

async function pressDigits(user: UserEvent, digits: string) {
  for (const digit of digits) await user.click(screen.getByRole('button', { name: digit }));
}

describe('a terminal that is not set up', () => {
  it('says so and links to the setup (criterion 1)', async () => {
    mockApi({ [REFRESH]: anonymous });
    renderApp('/pos');

    expect(
      await screen.findByRole('heading', { name: 'This terminal is not set up' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up this terminal' })).toHaveAttribute(
      'href',
      '/pos/setup?next=/pos',
    );
  });

  it('is set up by a manager, who is then signed out', async () => {
    const api = mockApi({
      [REFRESH]: () => json(sessionFor(fullBrandManager)),
      'GET /api/v1/brands': () => json(page([pizzaBrand])),
      [`GET /api/v1/brands/${ids.pizza}/branches`]: () => json(page([pizzaMall, pizzaDowntown])),
      [LOGOUT]: () => new Response(null, { status: 204 }),
    });
    const user = userEvent.setup();
    renderApp('/pos/setup');

    await user.click(await screen.findByRole('radio', { name: /Mall Branch/ }));
    await user.click(screen.getByRole('button', { name: 'Use this branch' }));

    expect(
      await screen.findByRole('heading', { name: 'Pizza Palace - Mall Branch' }),
    ).toBeVisible();
    expect(screen.getByLabelText('Staff code')).toBeInTheDocument();
    expect(api.count(LOGOUT)).toBe(1);
    expect(readTerminal()).toEqual(mall);
  });
});

describe('the PIN screen', () => {
  it('signs a cashier in at the branch of the terminal (criterion 2)', async () => {
    saveTerminal(mall);
    const api = terminalApi({ [REFRESH]: anonymous, [LOGIN]: () => json(sessionFor(fullCashier)) });
    const user = userEvent.setup();
    renderApp('/pos');

    await user.click(await screen.findByLabelText('Staff code'));
    await pressDigits(user, '1001');
    await user.click(screen.getByLabelText('PIN'));
    await pressDigits(user, '1234');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('button', { name: /Margherita/ })).toBeVisible();
    expect(api.calls.find((call) => call.key === LOGIN)?.body).toEqual({
      type: 'pin',
      branchId: ids.pizzaMall,
      staffCode: '1001',
      pin: '1234',
    });
  });

  it('says a wrong PIN in words and empties the PIN (criterion 3)', async () => {
    saveTerminal(mall);
    terminalApi({ [REFRESH]: anonymous, [LOGIN]: () => errorResponse(401, 'INVALID_CREDENTIALS') });
    const user = userEvent.setup();
    renderApp('/pos');

    await user.type(await screen.findByLabelText('Staff code'), '1001');
    await user.type(screen.getByLabelText('PIN'), '9999');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The staff code or PIN is not correct.',
    );
    expect(screen.getByLabelText('PIN')).toHaveValue('');
    expect(screen.getByLabelText('Staff code')).toHaveValue('1001');
  });

  it('tells kitchen staff they cannot take orders (criterion 8)', async () => {
    saveTerminal(mall);
    terminalApi({ [REFRESH]: () => json(sessionFor(kitchenStaff)) });
    renderApp('/pos');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Mall Branch Kitchen cannot take orders on this terminal.',
    );
  });

  it('turns away a person of another branch', async () => {
    saveTerminal({ ...mall, branchId: ids.pizzaDowntown, branchName: pizzaDowntown.name });
    terminalApi();
    renderApp('/pos');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Mall Branch Cashier does not work at this branch.',
    );
  });
});

describe('taking an order', () => {
  it('creates the order with its first dish (criterion 4)', async () => {
    saveTerminal(mall);
    nextIds(orderIds.first, lineIds.cola);
    const api = terminalApi({
      [CREATE]: () => json(order(), 201),
      [LINES]: () => json(colaOrder()),
    });
    const user = userEvent.setup();
    renderApp('/pos');

    await user.click(await screen.findByRole('tab', { name: 'Drinks' }));
    await user.click(screen.getByRole('button', { name: /Cola/ }));

    const panel = screen.getByRole('region', { name: 'Order' });
    expect(await within(panel).findByText('Cola')).toBeVisible();
    expect(within(panel).getByTestId('order-total')).toHaveTextContent('5.000');
    expect(within(panel).getByRole('heading', { name: 'Order 1' })).toBeVisible();

    expect(api.calls.find((call) => call.key === CREATE)?.body).toEqual({
      id: orderIds.first,
      branchId: ids.pizzaMall,
      type: 'takeaway',
    });
    expect(api.calls.find((call) => call.key === LINES)?.body).toEqual({
      kind: 'item',
      itemId: itemIds.cola,
      quantity: 1,
      modifierIds: [],
      id: lineIds.cola,
    });
  });

  it('asks for a required size before the dish is added (criterion 5)', async () => {
    saveTerminal(mall);
    nextIds(orderIds.first, lineIds.margherita);
    const api = terminalApi({
      [CREATE]: () => json(order({ type: 'dine_in' }), 201),
      [LINES]: () => json(order({ type: 'dine_in' })),
    });
    const user = userEvent.setup();
    renderApp('/pos');

    await user.click(await screen.findByRole('button', { name: 'Dine-in' }));
    await user.click(screen.getByRole('button', { name: /Margherita/ }));

    const dialog = screen.getByRole('dialog', { name: 'Margherita' });
    const add = within(dialog).getByRole('button', { name: 'Add to order' });
    expect(add).toBeDisabled();

    await user.click(within(dialog).getByRole('radio', { name: /Large/ }));
    await user.click(within(dialog).getByRole('button', { name: 'One more' }));
    expect(within(dialog).getByText('66.000')).toBeVisible();
    await user.click(add);

    await waitFor(() => expect(api.count(LINES)).toBe(1));
    expect(api.calls.find((call) => call.key === CREATE)?.body).toMatchObject({ type: 'dine_in' });
    expect(api.calls.find((call) => call.key === LINES)?.body).toMatchObject({
      kind: 'item',
      itemId: itemIds.margherita,
      quantity: 2,
      modifierIds: [modifierIds.large],
    });
  });

  it('says in words when a dish was switched off since the menu was loaded', async () => {
    saveTerminal(mall);
    nextIds(orderIds.first, lineIds.cola);
    const api = terminalApi({
      [CREATE]: () => json(order(), 201),
      [LINES]: () =>
        errorResponse(400, 'VALIDATION_ERROR', [{ path: 'itemId', message: 'ITEM_NOT_AVAILABLE' }]),
      [GET_FIRST]: () => json(order()),
    });
    const user = userEvent.setup();
    renderApp('/pos');

    await user.click(await screen.findByRole('tab', { name: 'Drinks' }));
    await user.click(screen.getByRole('button', { name: /Cola/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This dish is not on the menu of the branch any more.',
    );
    await waitFor(() => expect(api.count(MENU)).toBe(2));
  });

  it('sends the lines, then voids one with a manager (criterion 6)', async () => {
    saveTerminal(mall);
    nextIds(orderIds.first, lineIds.cola);
    const sent = orderLine({ status: 'sent', sentAt: '2026-10-13T09:01:00.000Z' });
    let voidCalls = 0;
    const api = terminalApi({
      [CREATE]: () => json(order(), 201),
      [LINES]: () => json(colaOrder()),
      [SEND]: () => json(colaOrder({ lines: [sent] })),
      [VOID_COLA]: () => {
        voidCalls += 1;
        if (voidCalls === 1) {
          return errorResponse(400, 'VALIDATION_ERROR', [
            { path: 'approval', message: 'APPROVAL_REQUIRED' },
          ]);
        }
        if (voidCalls === 2) {
          return errorResponse(400, 'VALIDATION_ERROR', [
            { path: 'approval', message: 'APPROVAL_INVALID' },
          ]);
        }
        return json(
          order({
            lines: [{ ...sent, status: 'voided', voidReason: 'Wrong item' }],
          }),
        );
      },
    });
    const user = userEvent.setup();
    renderApp('/pos');

    await user.click(await screen.findByRole('tab', { name: 'Drinks' }));
    await user.click(screen.getByRole('button', { name: /Cola/ }));
    await user.click(await screen.findByRole('button', { name: 'Send 1 item to kitchen' }));
    await user.click(await screen.findByRole('button', { name: 'Void Cola' }));

    const reasons = screen.getByRole('dialog', { name: 'Void Cola × 1' });
    await user.click(within(reasons).getByRole('radio', { name: 'Wrong item' }));
    await user.click(within(reasons).getByRole('button', { name: 'Void' }));

    const approval = await screen.findByRole('dialog', { name: 'A manager must approve' });
    await user.type(within(approval).getByLabelText('Staff code'), '1003');
    await user.type(within(approval).getByLabelText('PIN'), '1111');
    await user.click(within(approval).getByRole('button', { name: 'Approve' }));
    expect(await within(approval).findByRole('alert')).toHaveTextContent(
      'The staff code or PIN is not correct',
    );

    await user.type(within(approval).getByLabelText('PIN'), '5824');
    await user.click(within(approval).getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Voided: Wrong item')).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const bodies = api.calls.filter((call) => call.key === VOID_COLA).map((call) => call.body);
    expect(bodies).toEqual([
      { reason: 'Wrong item' },
      { reason: 'Wrong item', approval: { staffCode: '1003', pin: '1111' } },
      { reason: 'Wrong item', approval: { staffCode: '1003', pin: '5824' } },
    ]);
  });

  it('shows what a discount comes to before it is given (criterion 7)', async () => {
    saveTerminal(mall);
    const fifty = order({
      lines: [orderLine({ quantity: 10, lineTotal: '50.000' })],
      subtotal: '50.000',
      total: '50.000',
    });
    const api = terminalApi({
      [OPEN]: () => json(page([orderSummary(fifty)])),
      [GET_FIRST]: () => json(fifty),
      [`PUT /api/v1/orders/${orderIds.first}/discount`]: () =>
        json({
          ...fifty,
          discount: { kind: 'percent', value: '10.00', amount: '5.000', reason: 'Regular' },
          total: '45.000',
        }),
    });
    const user = userEvent.setup();
    renderApp('/pos');

    await user.click(await screen.findByRole('button', { name: 'Open orders' }));
    await user.click(await screen.findByRole('button', { name: /Order 1/ }));
    await user.click(await screen.findByRole('button', { name: 'Discount' }));

    const dialog = screen.getByRole('dialog', { name: 'Discount on the order' });
    await user.click(within(dialog).getByRole('button', { name: '10%' }));
    expect(within(dialog).getByTestId('discount-preview')).toHaveTextContent('5.000');
    await user.type(within(dialog).getByLabelText('Reason'), 'Regular');
    await user.click(within(dialog).getByRole('button', { name: 'Give discount' }));

    expect(await screen.findByTestId('order-total')).toHaveTextContent('45.000');
    expect(
      api.calls.find((call) => call.key === `PUT /api/v1/orders/${orderIds.first}/discount`)?.body,
    ).toEqual({ kind: 'percent', value: '10', reason: 'Regular' });
  });

  it('voids an order that was not sent without a manager, and starts a new one', async () => {
    saveTerminal(mall);
    nextIds(orderIds.first, lineIds.cola);
    const api = terminalApi({
      [CREATE]: () => json(order(), 201),
      [LINES]: () => json(colaOrder()),
      [`POST /api/v1/orders/${orderIds.first}/void`]: () =>
        json(colaOrder({ status: 'voided', voidReason: 'Other reason' })),
    });
    const user = userEvent.setup();
    renderApp('/pos');

    await user.click(await screen.findByRole('tab', { name: 'Drinks' }));
    await user.click(screen.getByRole('button', { name: /Cola/ }));
    await user.click(await screen.findByRole('button', { name: 'Void order' }));

    const dialog = screen.getByRole('dialog', { name: 'Void Order 1' });
    await user.click(within(dialog).getByRole('radio', { name: 'Other' }));
    await user.type(within(dialog).getByLabelText('The reason'), 'Other reason');
    await user.click(within(dialog).getByRole('button', { name: 'Void' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Order 1 was voided.');
    expect(screen.getByRole('heading', { name: 'New order' })).toBeVisible();
    expect(
      api.calls.find((call) => call.key === `POST /api/v1/orders/${orderIds.first}/void`)?.body,
    ).toEqual({ reason: 'Other reason' });
  });

  it('removes a line that was not sent with the minus button', async () => {
    saveTerminal(mall);
    nextIds(orderIds.first, lineIds.cola);
    terminalApi({
      [CREATE]: () => json(order(), 201),
      [LINES]: () => json(colaOrder()),
      [`DELETE /api/v1/orders/${orderIds.first}/lines/${lineIds.cola}`]: () => json(order()),
    });
    const user = userEvent.setup();
    renderApp('/pos');

    await user.click(await screen.findByRole('tab', { name: 'Drinks' }));
    await user.click(screen.getByRole('button', { name: /Cola/ }));
    await user.click(await screen.findByRole('button', { name: 'Remove Cola' }));

    expect(await screen.findByText('Tap a dish to start the order.')).toBeVisible();
  });

  it('finds dishes by their Arabic name', async () => {
    saveTerminal(mall);
    terminalApi();
    const user = userEvent.setup();
    renderApp('/pos');

    await user.type(await screen.findByRole('searchbox', { name: 'Search the menu' }), 'كولا');
    const menu = screen.getByRole('region', { name: 'Menu' });
    expect(within(menu).getByRole('button', { name: /Cola/ })).toBeVisible();
    expect(within(menu).queryByRole('button', { name: /Margherita/ })).not.toBeInTheDocument();
  });
});

describe('the admin menu', () => {
  it('links to the terminal for people who take orders', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(groupAdmin)),
      'GET /api/v1/brands': () => json(page([pizzaBrand])),
      [`GET /api/v1/brands/${ids.pizza}/branches`]: () => json(page([pizzaMall])),
    });
    renderApp('/admin');

    expect(await screen.findByRole('link', { name: 'POS terminal' })).toHaveAttribute(
      'href',
      '/pos',
    );
  });
});
