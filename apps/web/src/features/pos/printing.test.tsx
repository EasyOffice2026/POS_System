import type { MenuPrinter, Order } from '@pos/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
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
import { json, type MockHandler, mockApi } from '../../test/mock-api';
import { lineIds, order, orderIds, orderLine, orderSummary } from '../../test/order-fixtures';
import { renderApp } from '../../test/render-app';
import { forgetTerminal, saveTerminal } from './terminal-store';

// The picture is drawn on a canvas, which the test browser does not have.
vi.mock('./print-image', () => ({
  renderPrintImage: vi.fn(() => Promise.resolve('iVBORw0KGgo=')),
}));

const PAY = `POST /api/v1/orders/${orderIds.first}/pay`;
const GET_FIRST = `GET /api/v1/orders/${orderIds.first}`;
const CREATE = 'POST /api/v1/orders';
const LINES = `POST /api/v1/orders/${orderIds.first}/lines`;
const SEND = `POST /api/v1/orders/${orderIds.first}/send`;
const JOBS = 'POST /api/v1/print-jobs';
const jobId = '01990000-0000-7000-8000-0000000000c1';
const JOB = `GET /api/v1/print-jobs/${jobId}`;
const cashId = '01990000-0000-7000-8000-000000000901';

const receiptPrinter = {
  id: '01990000-0000-7000-8000-0000000000a1',
  name: 'Cash desk',
  kind: 'receipt' as const,
};
const kitchenPrinter = {
  id: '01990000-0000-7000-8000-0000000000a2',
  name: 'Pizza oven',
  kind: 'kitchen' as const,
};

afterEach(() => {
  forgetTerminal();
});

const open = order({ lines: [orderLine()], subtotal: '5.000', total: '5.000' });
const paid: Order = {
  ...open,
  status: 'paid',
  paidAt: '2026-10-13T09:30:00.000Z',
  paidById: fullCashier.id,
  change: '0.000',
  payments: [
    {
      id: cashId,
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
};

// A job as the API answers it, in the status given.
const job = (status: string, error: string | null = null) => ({
  id: jobId,
  branchId: ids.pizzaMall,
  printerId: receiptPrinter.id,
  printerName: 'Cash desk',
  kind: 'receipt',
  status,
  orderNumber: 1,
  attempts: status === 'queued' ? 0 : 1,
  error,
  createdAt: '2026-10-13T09:30:00.000Z',
  finishedAt: status === 'done' || status === 'failed' ? '2026-10-13T09:30:02.000Z' : null,
});

function tillApi(
  printers: MenuPrinter[],
  handlers: Record<string, MockHandler>,
  kitchen = { screen: true, slip: false, lateAfterMinutes: 12 },
) {
  saveTerminal({
    branchId: ids.pizzaMall,
    brandId: ids.pizza,
    branchName: pizzaMall.name,
    brandName: pizzaBrand.name,
  });
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(fullCashier)),
    'GET /api/v1/menu': () => json(branchMenu({ printers, kitchen })),
    'GET /api/v1/shifts/current': () => json(shiftSummary()),
    [`GET /api/v1/brands/${ids.pizza}/settings`]: () => json(brandSettings()),
    ...handlers,
  });
}

async function payCash(user: UserEvent) {
  vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(cashId);
  await user.click(await screen.findByRole('button', { name: 'Open orders' }));
  await user.click(await screen.findByRole('button', { name: /Order 1/ }));
  await user.click(await screen.findByRole('button', { name: /^Pay/ }));
  const dialog = screen.getByRole('dialog', { name: 'Pay order 1' });
  await user.click(within(dialog).getByRole('button', { name: 'Exact' }));
  await user.click(within(dialog).getByRole('button', { name: 'Confirm payment' }));
  return screen.findByRole('dialog', { name: 'Receipt' });
}

describe('printing a receipt on the printer of the branch (spec 028)', () => {
  it('leaves the receipt for the bridge instead of the browser, and says when it printed', async () => {
    let asked = 0;
    const api = tillApi([receiptPrinter], {
      'GET /api/v1/orders': () => json(page([orderSummary(open)])),
      [GET_FIRST]: () => json(open),
      [PAY]: () => json(paid),
      [JOBS]: () => json(job('queued'), 201),
      [JOB]: () => json(job(++asked < 2 ? 'printing' : 'done')),
    });
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderApp('/pos');

    const receipt = await payCash(user);
    await user.click(within(receipt).getByRole('button', { name: 'Print' }));

    expect(await within(receipt).findByRole('status')).toHaveTextContent('Sending to Cash desk');
    expect(api.calls.find((call) => call.key === JOBS)?.body).toEqual({
      branchId: ids.pizzaMall,
      printerId: receiptPrinter.id,
      kind: 'receipt',
      orderNumber: 1,
      image: 'iVBORw0KGgo=',
    });
    await waitFor(
      () => expect(within(receipt).getByRole('status')).toHaveTextContent('Printed on Cash desk.'),
      { timeout: 5000 },
    );
    expect(print).not.toHaveBeenCalled();
    print.mockRestore();
  });

  it('says why it did not print, and offers to print from this device instead', async () => {
    tillApi([receiptPrinter], {
      'GET /api/v1/orders': () => json(page([orderSummary(open)])),
      [GET_FIRST]: () => json(open),
      [PAY]: () => json(paid),
      [JOBS]: () => json(job('queued'), 201),
      [JOB]: () => json(job('failed', 'The printer at 192.168.1.50:9100 refused the connection')),
    });
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderApp('/pos');

    const receipt = await payCash(user);
    await user.click(within(receipt).getByRole('button', { name: 'Print' }));

    const alert = await within(receipt).findByRole('alert', undefined, { timeout: 5000 });
    expect(alert).toHaveTextContent(
      'Not printed on Cash desk: The printer at 192.168.1.50:9100 refused the connection',
    );
    await user.click(within(alert).getByRole('button', { name: 'Print from this device' }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it('prints through the browser, as before, when the branch has no receipt printer', async () => {
    const api = tillApi([kitchenPrinter], {
      'GET /api/v1/orders': () => json(page([orderSummary(open)])),
      [GET_FIRST]: () => json(open),
      [PAY]: () => json(paid),
    });
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderApp('/pos');

    const receipt = await payCash(user);
    await user.click(within(receipt).getByRole('button', { name: 'Print' }));

    expect(print).toHaveBeenCalledTimes(1);
    expect(api.count(JOBS)).toBe(0);
    expect(within(receipt).queryByRole('status')).not.toBeInTheDocument();
    // The printed copy fills the roll, 58 mm or 80 mm, at the text size of the screen (asked by
    // the client on 1 November 2026: the receipt was cut off on the right, or shrunk).
    const printed = screen.getAllByTestId('receipt').find((element) => !receipt.contains(element));
    expect(printed).toHaveClass('print:w-full', 'print:max-w-[80mm]', 'print:text-black');
    print.mockRestore();
  });
});

describe('printing the kitchen slip on the kitchen printer (spec 028)', () => {
  const sent = orderLine({ status: 'sent', sentAt: '2026-10-13T09:01:00.000Z' });

  async function sendCola(user: UserEvent) {
    const spy = vi.spyOn(crypto, 'randomUUID');
    spy.mockReturnValueOnce(orderIds.first as ReturnType<typeof crypto.randomUUID>);
    spy.mockReturnValueOnce(lineIds.cola as ReturnType<typeof crypto.randomUUID>);
    await user.click(await screen.findByRole('tab', { name: 'Drinks' }));
    await user.click(screen.getByRole('button', { name: /Cola/ }));
    await user.click(await screen.findByRole('button', { name: 'Send 1 item to kitchen' }));
  }

  it('leaves the slip for the bridge by itself when the order is sent', async () => {
    const api = tillApi(
      [receiptPrinter, kitchenPrinter],
      {
        [CREATE]: () => json(order(), 201),
        [LINES]: () => json(open),
        [SEND]: () => json({ ...open, lines: [sent] }),
        [JOBS]: () => json({ ...job('queued'), kind: 'kitchen', printerName: 'Pizza oven' }, 201),
        [JOB]: () => json({ ...job('done'), kind: 'kitchen', printerName: 'Pizza oven' }),
      },
      { screen: false, slip: false, lateAfterMinutes: 12 },
    );
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderApp('/pos');

    await sendCola(user);

    await waitFor(() => expect(api.count(JOBS)).toBe(1));
    expect(api.calls.find((call) => call.key === JOBS)?.body).toMatchObject({
      printerId: kitchenPrinter.id,
      kind: 'kitchen',
      orderNumber: 1,
    });
    await waitFor(() => expect(api.count(JOB)).toBeGreaterThan(0), { timeout: 5000 });
    expect(print).not.toHaveBeenCalled();
    expect(screen.queryByText('Kitchen slip:')).not.toBeInTheDocument();
    print.mockRestore();
  });

  it('tells the cashier when the slip did not print, with a way to print it here', async () => {
    tillApi(
      [kitchenPrinter],
      {
        [CREATE]: () => json(order(), 201),
        [LINES]: () => json(open),
        [SEND]: () => json({ ...open, lines: [sent] }),
        [JOBS]: () => json({ ...job('queued'), kind: 'kitchen', printerName: 'Pizza oven' }, 201),
        [JOB]: () =>
          json({
            ...job('failed', 'The printer at oven.local:9101 did not answer'),
            kind: 'kitchen',
            printerName: 'Pizza oven',
          }),
      },
      { screen: false, slip: false, lateAfterMinutes: 12 },
    );
    const printed: string[] = [];
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      printed.push(screen.getByTestId('kitchen-slip').textContent ?? '');
    });
    const user = userEvent.setup();
    renderApp('/pos');

    await sendCola(user);

    const alert = await screen.findByRole('alert', undefined, { timeout: 5000 });
    expect(alert).toHaveTextContent(
      'Not printed on Pizza oven: The printer at oven.local:9101 did not answer',
    );
    expect(screen.getByText('Kitchen slip:')).toBeVisible();
    await user.click(within(alert).getByRole('button', { name: 'Print from this device' }));
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain('1 × Cola');
    expect(screen.queryByText('Kitchen slip:')).not.toBeInTheDocument();
    print.mockRestore();
  });
});

describe('the logo on the receipt', () => {
  it('shows the brand logo at the top of the receipt when the brand has one', async () => {
    tillApi([], {
      'GET /api/v1/menu': () =>
        json(
          branchMenu({ brand: { logoUrl: 'https://cdn.example.com/mudawara.png', color: null } }),
        ),
      'GET /api/v1/orders': () => json(page([orderSummary(open)])),
      [GET_FIRST]: () => json(open),
      [PAY]: () => json(paid),
    });
    const user = userEvent.setup();
    renderApp('/pos');

    const receipt = await payCash(user);

    const logo = within(receipt).getByTestId('receipt-logo');
    expect(logo).toHaveAttribute('src', 'https://cdn.example.com/mudawara.png');
    expect(logo.compareDocumentPosition(within(receipt).getByText('Order 1'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('shows no picture when the brand has no logo', async () => {
    tillApi([], {
      'GET /api/v1/orders': () => json(page([orderSummary(open)])),
      [GET_FIRST]: () => json(open),
      [PAY]: () => json(paid),
    });
    const user = userEvent.setup();
    renderApp('/pos');

    const receipt = await payCash(user);

    expect(within(receipt).queryByTestId('receipt-logo')).not.toBeInTheDocument();
  });
});
