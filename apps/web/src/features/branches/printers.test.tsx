import { closedWeek, type Printer } from '@pos/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  branchDetail,
  branchManager,
  burgerBrand,
  groupAdmin,
  page,
  pizzaBrand,
  pizzaDowntown,
  pizzaMall,
  printer,
  sessionFor,
} from '../../test/fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const REFRESH = 'POST /api/v1/auth/refresh';
const one = `GET /api/v1/branches/${pizzaMall.id}`;
const patch = `PATCH /api/v1/branches/${pizzaMall.id}`;
const keyInfo = `GET /api/v1/branches/${pizzaMall.id}/print-bridge-key`;
const makeKey = `POST /api/v1/branches/${pizzaMall.id}/print-bridge-key`;

const withPrinters = (...printers: Printer[]) =>
  branchDetail({
    config: {
      openingHours: closedWeek(),
      printers,
      dayEndsAt: '00:00',
      specialHours: [],
      kitchen: { screen: true, slip: false, lateAfterMinutes: 12 },
      orderTypes: { dine_in: true, takeaway: true, delivery: false },
    },
  });

const directory: Record<string, MockHandler> = {
  'GET /api/v1/brands': () => json(page([pizzaBrand, burgerBrand])),
  [`GET /api/v1/brands/${pizzaBrand.id}/branches`]: () => json(page([pizzaMall, pizzaDowntown])),
  [`GET /api/v1/brands/${burgerBrand.id}/branches`]: () => json(page([])),
};

function openPrinters(branch = branchDetail(), extra: Record<string, MockHandler> = {}) {
  const api = mockApi({
    [REFRESH]: () => json(sessionFor(groupAdmin)),
    [one]: () => json(branch),
    [keyInfo]: () => json({ createdAt: null }),
    ...directory,
    ...extra,
  });
  renderApp(`/admin/branches/${pizzaMall.id}?tab=printers`);
  return api;
}

const bodyOf = (api: ReturnType<typeof mockApi>) =>
  api.calls.find((call) => call.key === patch)?.body;

const printerBox = (n: number) => screen.getByRole('group', { name: `Printer ${n}` });

type User = ReturnType<typeof userEvent.setup>;

async function addPrinter(user: User, name: string, host: string) {
  await user.click(await screen.findByRole('button', { name: 'Add printer' }));
  const boxes = screen.getAllByRole('group');
  const box = within(boxes[boxes.length - 1] as HTMLElement);
  await user.type(box.getByLabelText('Name'), name);
  await user.type(box.getByLabelText('Address'), host);
}

describe('the printers of a branch', () => {
  it('says so when there are none, and offers to add one', async () => {
    openPrinters();

    expect(await screen.findByText('This branch has no printers yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add printer' })).toBeInTheDocument();
  });

  it('shows each printer with its name, type, address and port', async () => {
    openPrinters(
      withPrinters(
        printer(1, { name: 'Cash desk', host: '192.168.1.50' }),
        printer(2, { name: 'Pizza oven', kind: 'kitchen', host: 'oven.local', port: 9101 }),
      ),
    );

    await screen.findByRole('group', { name: 'Printer 1' });

    const first = within(printerBox(1));
    expect(first.getByLabelText('Name')).toHaveValue('Cash desk');
    expect(first.getByLabelText('Type')).toHaveValue('receipt');
    expect(first.getByLabelText('Address')).toHaveValue('192.168.1.50');
    expect(first.getByLabelText('Port')).toHaveValue('9100');
    const second = within(printerBox(2));
    expect(second.getByLabelText('Type')).toHaveValue('kitchen');
    expect(second.getByLabelText('Address')).toHaveValue('oven.local');
    expect(second.getByLabelText('Port')).toHaveValue('9101');
  });

  it('offers receipts and kitchen tickets as the types', async () => {
    openPrinters(withPrinters(printer(1)));

    const select = within(await screen.findByRole('group', { name: 'Printer 1' })).getByLabelText(
      'Type',
    );

    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Receipts', 'Kitchen tickets']);
  });

  it('writes the address and the port left to right', async () => {
    openPrinters(withPrinters(printer(1)));

    const box = within(await screen.findByRole('group', { name: 'Printer 1' }));

    expect(box.getByLabelText('Address')).toHaveAttribute('dir', 'ltr');
    expect(box.getByLabelText('Port')).toHaveAttribute('dir', 'ltr');
  });
});

describe('adding, changing and removing printers', () => {
  it('adds a printer with the usual port, and sends it without an id', async () => {
    const user = userEvent.setup();
    const api = openPrinters(branchDetail(), {
      [patch]: () => json(withPrinters(printer(1, { name: 'Cash desk', host: '192.168.1.50' }))),
    });

    await addPrinter(user, 'Cash desk', '192.168.1.50');
    expect(within(printerBox(1)).getByLabelText('Port')).toHaveValue('9100');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Printers saved.');
    expect(bodyOf(api)).toEqual({
      config: {
        printers: [{ name: 'Cash desk', kind: 'receipt', host: '192.168.1.50', port: 9100 }],
      },
    });
  });

  it('sends the id of a printer that was there, so it stays the same printer', async () => {
    const user = userEvent.setup();
    const existing = printer(1, { name: 'Cash desk' });
    const api = openPrinters(withPrinters(existing), {
      [patch]: () => json(withPrinters({ ...existing, name: 'Front desk' })),
    });
    const name = within(await screen.findByRole('group', { name: 'Printer 1' })).getByLabelText(
      'Name',
    );

    await user.clear(name);
    await user.type(name, 'Front desk');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('status');
    expect(bodyOf(api)).toEqual({
      config: {
        printers: [
          { id: existing.id, name: 'Front desk', kind: 'receipt', host: existing.host, port: 9100 },
        ],
      },
    });
  });

  it('changes the type of a printer', async () => {
    const user = userEvent.setup();
    const existing = printer(1);
    const api = openPrinters(withPrinters(existing), {
      [patch]: () => json(withPrinters({ ...existing, kind: 'kitchen' })),
    });

    await user.selectOptions(
      within(await screen.findByRole('group', { name: 'Printer 1' })).getByLabelText('Type'),
      'kitchen',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('status');
    expect(bodyOf(api)).toMatchObject({
      config: { printers: [{ id: existing.id, kind: 'kitchen' }] },
    });
  });

  it('removes a printer, and sends the ones that are left', async () => {
    const user = userEvent.setup();
    const [first, second] = [printer(1), printer(2)];
    const api = openPrinters(withPrinters(first, second), {
      [patch]: () => json(withPrinters(second)),
    });

    await user.click(await screen.findByRole('button', { name: 'Remove printer 1' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('status');
    expect(bodyOf(api)).toEqual({
      config: {
        printers: [
          { id: second.id, name: second.name, kind: 'receipt', host: second.host, port: 9100 },
        ],
      },
    });
  });

  it('saves a branch with all its printers removed', async () => {
    const user = userEvent.setup();
    const api = openPrinters(withPrinters(printer(1)), { [patch]: () => json(branchDetail()) });

    await user.click(await screen.findByRole('button', { name: 'Remove printer 1' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('This branch has no printers yet.')).toBeInTheDocument();
    expect(bodyOf(api)).toEqual({ config: { printers: [] } });
  });

  it('allows several printers of one kind, such as two receipt printers', async () => {
    const user = userEvent.setup();
    const api = openPrinters(branchDetail(), {
      [patch]: () => json(branchDetail()),
    });

    await addPrinter(user, 'Desk 1', '10.0.0.1');
    await addPrinter(user, 'Desk 2', '10.0.0.2');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('status');
    expect(bodyOf(api)).toMatchObject({
      config: {
        printers: [
          { name: 'Desk 1', kind: 'receipt', host: '10.0.0.1' },
          { name: 'Desk 2', kind: 'receipt', host: '10.0.0.2' },
        ],
      },
    });
  });

  it('leaves the port out when it is emptied, so the server uses the usual one', async () => {
    const user = userEvent.setup();
    const api = openPrinters(branchDetail(), { [patch]: () => json(branchDetail()) });
    await addPrinter(user, 'Desk', '10.0.0.1');

    await user.clear(within(printerBox(1)).getByLabelText('Port'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('status');
    expect(bodyOf(api)).toEqual({
      config: { printers: [{ name: 'Desk', kind: 'receipt', host: '10.0.0.1' }] },
    });
  });

  it('shows the printers the way the server kept them, with the ids it made', async () => {
    const user = userEvent.setup();
    const saved = printer(1, { name: 'Desk', host: '10.0.0.1' });
    const api = openPrinters(branchDetail(), {
      [patch]: () => json(withPrinters(saved)),
    });
    await addPrinter(user, 'Desk', '10.0.0.1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('status');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.count(patch)).toBe(2));
    expect(api.calls.filter((call) => call.key === patch)[1]?.body).toMatchObject({
      config: { printers: [{ id: saved.id }] },
    });
  });

  it('stops offering more printers at the limit of twenty', async () => {
    openPrinters(withPrinters(...Array.from({ length: 20 }, (_, index) => printer(index + 1))));

    await screen.findByRole('group', { name: 'Printer 20' });

    expect(screen.queryByRole('button', { name: 'Add printer' })).not.toBeInTheDocument();
  });

  it('takes the saved message away when something is changed again', async () => {
    const user = userEvent.setup();
    openPrinters(withPrinters(printer(1)), { [patch]: () => json(withPrinters(printer(1))) });
    await screen.findByRole('group', { name: 'Printer 1' });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('status');

    await user.type(within(printerBox(1)).getByLabelText('Name'), '!');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('problems with the printers', () => {
  it('asks for a name, and sends nothing', async () => {
    const user = userEvent.setup();
    const api = openPrinters();
    await user.click(await screen.findByRole('button', { name: 'Add printer' }));
    await user.type(within(printerBox(1)).getByLabelText('Address'), '10.0.0.1');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(within(printerBox(1)).getByLabelText('Name')).toHaveAccessibleDescription(
      'Enter a name for the printer.',
    );
    expect(bodyOf(api)).toBeUndefined();
  });

  it.each(['http://192.168.1.50', '999.1.1.1', 'printer 1', ''])(
    'refuses the address "%s"',
    async (host) => {
      const user = userEvent.setup();
      const api = openPrinters(withPrinters(printer(1)));
      const box = within(await screen.findByRole('group', { name: 'Printer 1' }));
      await user.clear(box.getByLabelText('Address'));
      if (host) await user.type(box.getByLabelText('Address'), host);

      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(box.getByLabelText('Address')).toHaveAccessibleDescription(
        /Enter an IP address or a host name, without http:\/\/ and without a port\./,
      );
      expect(bodyOf(api)).toBeUndefined();
    },
  );

  it.each(['abc', '0', '65536', '9100.5'])('refuses the port "%s"', async (port) => {
    const user = userEvent.setup();
    const api = openPrinters(withPrinters(printer(1)));
    const box = within(await screen.findByRole('group', { name: 'Printer 1' }));
    await user.clear(box.getByLabelText('Port'));
    await user.type(box.getByLabelText('Port'), port);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(box.getByLabelText('Port')).toHaveAccessibleDescription(
      /The port is a number from 1 to 65535\./,
    );
    expect(bodyOf(api)).toBeUndefined();
  });

  it('refuses two printers with the same name, whatever the capital letters, on the later one', async () => {
    const user = userEvent.setup();
    const api = openPrinters(
      withPrinters(printer(1, { name: 'Desk' }), printer(2, { name: 'Oven' })),
    );
    await screen.findByRole('group', { name: 'Printer 1' });
    const second = within(printerBox(2)).getByLabelText('Name');
    await user.clear(second);
    await user.type(second, 'DESK');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(within(printerBox(2)).getByLabelText('Name')).toHaveAccessibleDescription(
      'Another printer at this branch has this name.',
    );
    expect(within(printerBox(1)).getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
    expect(bodyOf(api)).toBeUndefined();
  });

  it('shows a problem the server finds on the printer that has it', async () => {
    const user = userEvent.setup();
    openPrinters(withPrinters(printer(1), printer(2)), {
      [patch]: () =>
        errorResponse(400, 'VALIDATION_ERROR', [
          { path: 'config.printers.1.host', message: 'PRINTER_HOST_INVALID' },
        ]),
    });
    await screen.findByRole('group', { name: 'Printer 1' });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(within(printerBox(2)).getByLabelText('Address')).toHaveAttribute(
        'aria-invalid',
        'true',
      ),
    );
    expect(within(printerBox(1)).getByLabelText('Address')).not.toHaveAttribute('aria-invalid');
  });

  it('says so when the printers could not be saved', async () => {
    const user = userEvent.setup();
    openPrinters(withPrinters(printer(1)), { [patch]: () => errorResponse(500, 'INTERNAL_ERROR') });
    await screen.findByRole('group', { name: 'Printer 1' });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save. Try again.');
  });
});

describe('the printers in Arabic, and for somebody who may not change them', () => {
  it('writes the labels and the choices in Arabic when the language is switched', async () => {
    const user = userEvent.setup();
    openPrinters(withPrinters(printer(1)));
    await screen.findByRole('group', { name: 'Printer 1' });

    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    const box = within(await screen.findByRole('group', { name: 'الطابعة 1' }));
    expect(box.getByLabelText('الاسم')).toHaveValue('Printer 1');
    expect(box.getByRole('option', { name: 'الإيصالات' })).toBeInTheDocument();
    expect(box.getByRole('option', { name: 'تذاكر المطبخ' })).toBeInTheDocument();
    expect(box.getByLabelText('العنوان')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('button', { name: 'إضافة طابعة' })).toBeInTheDocument();
  });

  it('shows the printers of a branch to a branch manager, with nothing to change', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(branchManager)),
      [one]: () => json(withPrinters(printer(1))),
      [`GET /api/v1/brands/${pizzaBrand.id}/branches`]: () => json(page([pizzaMall])),
    });
    renderApp(`/admin/branches/${pizzaMall.id}?tab=printers`);

    const box = within(await screen.findByRole('group', { name: 'Printer 1' }));

    expect(box.getByLabelText('Name')).toBeDisabled();
    expect(box.getByLabelText('Address')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add printer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove printer 1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});

describe('the key of the print bridge (spec 028)', () => {
  it('says there is none, makes one and shows it once', async () => {
    const user = userEvent.setup();
    const api = openPrinters(withPrinters(printer(1)), {
      [makeKey]: () => json({ key: 'pb_abc123', createdAt: '2026-11-01T09:00:00.000Z' }, 201),
    });

    expect(await screen.findByText('This branch has no bridge key yet.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Make a key' }));

    expect(await screen.findByLabelText('Bridge key')).toHaveValue('pb_abc123');
    expect(screen.getByText('Copy the key now: it is shown only once.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Make a new key' })).toBeVisible();
    expect(screen.getByText(/A key was made on 1 Nov 2026/)).toBeVisible();
    expect(api.count(makeKey)).toBe(1);
  });

  it('says when the key was made, and offers a new one', async () => {
    openPrinters(withPrinters(printer(1)), {
      [keyInfo]: () => json({ createdAt: '2026-10-20T07:30:00.000Z' }),
    });

    expect(
      await screen.findByText(/A key was made on 20 Oct 2026.*Making a new one stops the old one/),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Make a new key' })).toBeVisible();
    expect(screen.queryByLabelText('Bridge key')).not.toBeInTheDocument();
  });

  it('is not offered to someone who may only look', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(branchManager)),
      [one]: () => json(withPrinters(printer(1))),
      ...directory,
    });
    renderApp(`/admin/branches/${pizzaMall.id}?tab=printers`);

    await screen.findByRole('group', { name: 'Printer 1' });
    expect(screen.queryByText('Print bridge')).not.toBeInTheDocument();
  });
});
