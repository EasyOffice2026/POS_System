import type { Ingredient, PurchaseOrder } from '@pos/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { branchManager, ids, page, pizzaBrand, pizzaMall, sessionFor } from '../../test/fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const orderId = '01990000-0000-7000-8000-00000000e001';
const ONE = `GET /api/v1/inventory/purchase-orders/${orderId}`;
const RECEIVE = `POST /api/v1/inventory/purchase-orders/${orderId}/receive`;

const mozzarella: Ingredient = {
  id: '01990000-0000-7000-8000-000000009002',
  brandId: ids.pizza,
  name: { en: 'Mozzarella', ar: 'موزاريلا' },
  unit: 'kg',
  costPerUnit: '3.000',
  lowLevel: '2.000',
  isActive: true,
};
const butter: Ingredient = {
  ...mozzarella,
  id: '01990000-0000-7000-8000-000000009004',
  name: { en: 'Butter', ar: 'زبدة' },
};

const line = (ingredient: Ingredient, quantity: string, unitPrice: string, lineTotal: string) => ({
  ingredient,
  quantity,
  unitPrice,
  lineTotal,
  receivedQuantity: null,
  receivedPrice: null,
  receivedTotal: null,
});

// Order 7, sent: 12 kg of mozzarella at 2.800 and 2 kg of butter at 4.000.
const sent: PurchaseOrder = {
  id: orderId,
  number: 7,
  brandId: ids.pizza,
  branchId: ids.pizzaMall,
  supplier: {
    id: '01990000-0000-7000-8000-00000000d001',
    name: 'Gulf Dairy',
    contactName: null,
    phone: null,
    email: null,
  },
  branch: { id: ids.pizzaMall, name: pizzaMall.name, address: null },
  status: 'sent',
  expectedOn: null,
  note: null,
  total: '41.600',
  lineCount: 2,
  createdByName: 'Mall Branch Manager',
  createdAt: '2026-10-15T09:00:00.000Z',
  sentByName: 'Mall Branch Manager',
  sentAt: '2026-10-15T10:00:00.000Z',
  cancelledByName: null,
  cancelledAt: null,
  cancelReason: null,
  receivedByName: null,
  receivedAt: null,
  invoiceNumber: null,
  receiveNote: null,
  receivedTotal: null,
  lines: [line(butter, '2.000', '4.000', '8.000'), line(mozzarella, '12.000', '2.800', '33.600')],
};

const received: PurchaseOrder = {
  ...sent,
  status: 'received',
  receivedByName: 'Mall Branch Manager',
  receivedAt: '2026-10-16T07:30:00.000Z',
  invoiceNumber: 'INV-5521',
  receivedTotal: '41.350',
  lines: [
    {
      ...line(butter, '2.000', '4.000', '8.000'),
      receivedQuantity: '2.000',
      receivedPrice: '4.000',
      receivedTotal: '8.000',
    },
    {
      ...line(mozzarella, '12.000', '2.800', '33.600'),
      receivedQuantity: '11.500',
      receivedPrice: '2.900',
      receivedTotal: '33.350',
    },
  ],
};

const manager = {
  ...branchManager,
  permissions: [
    ...branchManager.permissions,
    'inventory:read' as const,
    'inventory:write' as const,
  ],
};

// The order as the server has it now: what a write answers is what GET answers next.
let current: PurchaseOrder = sent;

function receiptApi(handlers: Record<string, MockHandler> = {}, user = manager) {
  current = sent;
  const remembered = Object.fromEntries(
    Object.entries(handlers).map(([key, handler]) => [
      key,
      async (request: Parameters<MockHandler>[0]) => {
        const response = await handler(request);
        if (response.ok) current = (await response.clone().json()) as PurchaseOrder;
        return response;
      },
    ]),
  );
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(user)),
    'GET /api/v1/brands': () => json(page([pizzaBrand])),
    [`GET /api/v1/brands/${ids.pizza}/branches`]: () => json(page([pizzaMall])),
    'GET /api/v1/inventory/purchase-orders': () => json(page([])),
    'GET /api/v1/inventory/stock': () => json({ data: [] }),
    'GET /api/v1/inventory/alerts': () => json({ data: [] }),
    [ONE]: () => json(current),
    ...remembered,
  });
}

describe('receiving goods', () => {
  it('fills in what was ordered, takes what really arrived and shows both after', async () => {
    const api = receiptApi({ [RECEIVE]: () => json(received) });
    const user = userEvent.setup();
    renderApp(`/admin/inventory/purchase-orders/${orderId}`);

    await user.click(await screen.findByRole('button', { name: 'Receive goods' }));
    const quantity = screen.getByLabelText('Mozzarella');
    expect(quantity).toHaveValue('12.000');
    expect(screen.getByLabelText('Unit price of Mozzarella')).toHaveValue('2.800');
    await user.clear(quantity);
    await user.type(quantity, '11.5');
    const price = screen.getByLabelText('Unit price of Mozzarella');
    await user.clear(price);
    await user.type(price, '2.9');
    const total = screen.getByText('Received total').closest('tr') as HTMLElement;
    expect(within(total).getByText('41.350')).toBeVisible();
    await user.type(screen.getByLabelText("Supplier's invoice number (optional)"), 'INV-5521');
    await user.click(screen.getByRole('button', { name: 'Put into stock' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Goods received.');
    expect(api.calls.find((call) => call.key === RECEIVE)?.body).toEqual({
      invoiceNumber: 'INV-5521',
      note: '',
      lines: [
        { ingredientId: butter.id, quantity: '2.000', unitPrice: '4.000' },
        { ingredientId: mozzarella.id, quantity: '11.5', unitPrice: '2.9' },
      ],
    });

    // Ordered next to received, the differences marked.
    expect(screen.getByText(/Received by Mall Branch Manager/)).toHaveTextContent(
      'Invoice INV-5521',
    );
    const row = within(screen.getByRole('table'))
      .getByText('Mozzarella')
      .closest('tr') as HTMLElement;
    expect(within(row).getByText('11.500').parentElement).toHaveClass('bg-amber-100');
    expect(within(row).getByText('ordered at 2.800')).toBeVisible();
    const butterRow = within(screen.getByRole('table'))
      .getByText('Butter')
      .closest('tr') as HTMLElement;
    expect(within(butterRow).getAllByText('2.000')[1]?.parentElement).not.toHaveClass(
      'bg-amber-100',
    );
    expect(screen.queryByRole('button', { name: 'Receive goods' })).not.toBeInTheDocument();
  });

  it('needs at least one quantity that arrived before asking the server', async () => {
    const api = receiptApi();
    const user = userEvent.setup();
    renderApp(`/admin/inventory/purchase-orders/${orderId}`);

    await user.click(await screen.findByRole('button', { name: 'Receive goods' }));
    for (const name of ['Mozzarella', 'Butter']) {
      await user.clear(screen.getByLabelText(name));
      await user.type(screen.getByLabelText(name), '0');
    }
    await user.click(screen.getByRole('button', { name: 'Put into stock' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Type at least one quantity that arrived.');
    expect(api.count(RECEIVE)).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Receive goods' })).toBeVisible();
  });

  it('shows the answer when the order was received already', async () => {
    receiptApi({ [RECEIVE]: () => errorResponse(409, 'ORDER_NOT_SENT') });
    const user = userEvent.setup();
    renderApp(`/admin/inventory/purchase-orders/${orderId}`);

    await user.click(await screen.findByRole('button', { name: 'Receive goods' }));
    await user.click(screen.getByRole('button', { name: 'Put into stock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only a sent order can be received, and only once.',
    );
  });

  it('is not offered to a person who may only see the stock', async () => {
    receiptApi({}, { ...branchManager, permissions: ['branches:read', 'inventory:read'] });
    renderApp(`/admin/inventory/purchase-orders/${orderId}`);

    expect(await screen.findByRole('heading', { name: 'Purchase order 7' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Receive goods' })).not.toBeInTheDocument();
  });
});
