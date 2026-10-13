import type { BranchStock, Ingredient, StockTransfer } from '@pos/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { describe, expect, it } from 'vitest';
import {
  branchManager,
  fullBrandManager,
  ids,
  page,
  pizzaBrand,
  pizzaDowntown,
  pizzaMall,
  sessionFor,
} from '../../test/fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const TRANSFERS = 'GET /api/v1/inventory/transfers';
const DESTINATIONS = 'GET /api/v1/inventory/transfers/destinations';
const STOCK = 'GET /api/v1/inventory/stock';
const SEND = 'POST /api/v1/inventory/transfers';
const transferId = '01990000-0000-7000-8000-00000000b001';
const ONE = `GET /api/v1/inventory/transfers/${transferId}`;
const RECEIVE = `POST /api/v1/inventory/transfers/${transferId}/receive`;
const CANCEL = `POST /api/v1/inventory/transfers/${transferId}/cancel`;

const mozzarella: Ingredient = {
  id: '01990000-0000-7000-8000-000000009002',
  brandId: ids.pizza,
  name: { en: 'Mozzarella', ar: 'موزاريلا' },
  unit: 'kg',
  costPerUnit: '3.000',
  lowLevel: '2.000',
  isActive: true,
};
const flour: Ingredient = {
  ...mozzarella,
  id: '01990000-0000-7000-8000-000000009001',
  name: { en: 'Flour', ar: 'طحين' },
  costPerUnit: '0.400',
};

const stockOf = (ingredient: Ingredient, quantity: string): BranchStock => ({
  branchId: ids.pizzaDowntown,
  ingredient,
  quantity,
  lowLevel: null,
  isLow: false,
  value: '0.000',
});

// Transfer 12: 2 kg of mozzarella sent from Downtown to the Mall.
const sent: StockTransfer = {
  id: transferId,
  number: 12,
  brandId: ids.pizza,
  fromBranch: { id: ids.pizzaDowntown, name: pizzaDowntown.name },
  toBranch: { id: ids.pizzaMall, name: pizzaMall.name },
  status: 'sent',
  note: 'For the weekend',
  lines: [{ ingredient: mozzarella, quantity: '2.000' }],
  sentById: '01990000-0000-7000-8000-000000000106',
  sentByName: 'Downtown Manager',
  sentAt: '2026-10-14T09:00:00.000Z',
  receivedById: null,
  receivedByName: null,
  receivedAt: null,
  cancelledById: null,
  cancelledByName: null,
  cancelledAt: null,
  cancelReason: null,
};

// The Mall's manager: sees the Mall only, may change its stock.
const mallManager = {
  ...branchManager,
  permissions: [
    ...branchManager.permissions,
    'inventory:read' as const,
    'inventory:write' as const,
  ],
};

// The transfer as the server has it now: receiving and cancelling change what GET answers.
let current: StockTransfer = sent;

function transfersApi(user = fullBrandManager, handlers: Record<string, MockHandler> = {}) {
  current = sent;
  const branches = user.scope === 'BRANCH' ? [pizzaMall] : [pizzaMall, pizzaDowntown];
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(user)),
    'GET /api/v1/brands': () => json(page([pizzaBrand])),
    [`GET /api/v1/brands/${ids.pizza}/branches`]: () => json(page(branches)),
    [TRANSFERS]: () => json(page([sent])),
    [ONE]: () => json(current),
    [DESTINATIONS]: () => json({ data: [{ id: ids.pizzaDowntown, name: pizzaDowntown.name }] }),
    [STOCK]: () => json({ data: [stockOf(flour, '10.000'), stockOf(mozzarella, '5.000')] }),
    ...handlers,
  });
}

const bodyOf = (mock: ReturnType<typeof mockApi>, key: string) =>
  mock.calls.find((call) => call.key === key)?.body;

describe('the transfers of a branch', () => {
  it('are listed with their direction, status and who sent them', async () => {
    transfersApi(mallManager);
    renderApp('/admin/inventory/transfers');

    const rows = await screen.findAllByRole('row');
    const row = rows[1] as HTMLElement;
    expect(within(row).getByText('#12')).toBeVisible();
    expect(within(row).getByText('From Pizza Palace - Downtown Branch')).toBeVisible();
    expect(within(row).getByText('Sent')).toBeVisible();
    expect(within(row).getByText('Downtown Manager')).toBeVisible();
  });

  it('opens one, and the receiving branch receives it', async () => {
    const api = transfersApi(mallManager, {
      [RECEIVE]: () => {
        current = {
          ...sent,
          status: 'received',
          receivedByName: 'Mall Branch Manager',
          receivedAt: '2026-10-14T10:00:00.000Z',
        };
        return json(current);
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/inventory/transfers');

    await user.click(await screen.findByRole('button', { name: 'Open transfer 12' }));
    const dialog = await screen.findByRole('dialog', { name: 'Transfer 12' });
    expect(within(dialog).getByText('Mozzarella')).toBeVisible();
    expect(within(dialog).getByText('2.000')).toBeVisible();
    expect(within(dialog).getByText('For the weekend')).toBeVisible();
    expect(
      within(dialog).queryByRole('button', { name: 'Cancel transfer' }),
    ).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Receive' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Transfer received.');
    expect(api.calls.some((call) => call.key === RECEIVE)).toBe(true);
    expect(within(dialog).getByText('Received')).toBeVisible();
    expect(within(dialog).getByText(/Received by Mall Branch Manager/)).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Receive' })).not.toBeInTheDocument();
  });

  it('lets the sender cancel with a reason, and shows the API’s answer when too late', async () => {
    let calls = 0;
    const api = transfersApi(fullBrandManager, {
      [CANCEL]: () => {
        calls += 1;
        return calls === 1
          ? errorResponse(409, 'TRANSFER_NOT_SENT')
          : json(
              (current = {
                ...sent,
                status: 'cancelled',
                cancelledByName: 'Pizza Palace Manager',
                cancelledAt: '2026-10-14T10:00:00.000Z',
                cancelReason: 'Sent by mistake',
              }),
            );
      },
    });
    const user = userEvent.setup();
    renderApp(`/admin/inventory/transfers?branchId=${ids.pizzaDowntown}`);

    const rows = await screen.findAllByRole('row');
    expect(within(rows[1] as HTMLElement).getByText('To Pizza Palace - Mall Branch')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Open transfer 12' }));
    const dialog = await screen.findByRole('dialog', { name: 'Transfer 12' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel transfer' }));
    await user.click(within(dialog).getByRole('button', { name: 'Confirm the cancellation' }));
    expect(within(dialog).getByText('Say why.')).toBeVisible();
    expect(api.calls.some((call) => call.key === CANCEL)).toBe(false);

    await user.type(within(dialog).getByLabelText('Why is it cancelled?'), 'Sent by mistake');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm the cancellation' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This transfer was received or cancelled already.',
    );

    await user.click(within(dialog).getByRole('button', { name: 'Confirm the cancellation' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Transfer cancelled.');
    expect(bodyOf(api, CANCEL)).toEqual({ reason: 'Sent by mistake' });
    expect(within(dialog).getByText(/Cancelled by Pizza Palace Manager/)).toHaveTextContent(
      'Sent by mistake',
    );
  });

  it('sends a new transfer with the stock the sender has shown', async () => {
    const api = transfersApi(mallManager, {
      [SEND]: () => json({ ...sent, number: 13 }, 201),
    });
    const user = userEvent.setup();
    renderApp('/admin/inventory/transfers');

    await user.click(await screen.findByRole('button', { name: 'New transfer' }));
    const dialog = screen.getByRole('dialog', { name: 'New transfer' });
    await user.selectOptions(
      await within(dialog).findByLabelText('Send to'),
      'Pizza Palace - Downtown Branch',
    );
    await user.selectOptions(
      await within(dialog).findByLabelText('Add an ingredient'),
      'Mozzarella',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(within(dialog).getByText('In stock: 5.000 kg')).toBeVisible();
    // An ingredient already on the transfer cannot be added twice.
    expect(
      within(within(dialog).getByLabelText('Add an ingredient')).queryByRole('option', {
        name: 'Mozzarella',
      }),
    ).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(within(dialog).getByLabelText('Mozzarella')).toHaveAccessibleDescription(
      'Type a quantity of 0 or more, with up to 3 decimals.',
    );
    await user.type(within(dialog).getByLabelText('Mozzarella'), '2');
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'For the weekend');
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Transfer sent.');
    expect(bodyOf(api, SEND)).toEqual({
      fromBranchId: ids.pizzaMall,
      toBranchId: ids.pizzaDowntown,
      note: 'For the weekend',
      lines: [{ ingredientId: mozzarella.id, quantity: '2' }],
    });
  });

  it('asks for a branch to send to before sending', async () => {
    const api = transfersApi(mallManager);
    const user = userEvent.setup();
    renderApp('/admin/inventory/transfers');

    await user.click(await screen.findByRole('button', { name: 'New transfer' }));
    const dialog = screen.getByRole('dialog', { name: 'New transfer' });
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(within(dialog).getByLabelText('Send to')).toBeInvalid();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Add at least one ingredient.');
    expect(api.calls.some((call) => call.key === SEND)).toBe(false);
  });

  it('has no sending for a person who may only see the stock', async () => {
    transfersApi({ ...branchManager, permissions: ['branches:read', 'inventory:read'] });
    renderApp('/admin/inventory/transfers');

    expect(await screen.findByText('#12')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'New transfer' })).not.toBeInTheDocument();
  });

  it('shows the words of the screen in Arabic', async () => {
    await i18n.changeLanguage('ar');
    transfersApi(mallManager);
    renderApp('/admin/inventory/transfers');

    expect(await screen.findByText('من بيتزا بالاس - فرع وسط المدينة')).toBeVisible();
    expect(screen.getByRole('button', { name: 'تحويل جديد' })).toBeVisible();
    await i18n.changeLanguage('en');
  });
});
