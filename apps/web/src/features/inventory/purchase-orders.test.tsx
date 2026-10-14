import type { Ingredient, PurchaseOrder, Supplier, SupplierDetail } from '@pos/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { branchManager, ids, page, pizzaBrand, pizzaMall, sessionFor } from '../../test/fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const orderId = '01990000-0000-7000-8000-00000000e001';
const supplierId = '01990000-0000-7000-8000-00000000d001';
const LIST = 'GET /api/v1/inventory/purchase-orders';
const CREATE = 'POST /api/v1/inventory/purchase-orders';
const ONE = `GET /api/v1/inventory/purchase-orders/${orderId}`;
const UPDATE = `PUT /api/v1/inventory/purchase-orders/${orderId}`;
const SEND = `POST /api/v1/inventory/purchase-orders/${orderId}/send`;
const CANCEL = `POST /api/v1/inventory/purchase-orders/${orderId}/cancel`;
const SUPPLIERS = 'GET /api/v1/inventory/suppliers';
const SUPPLIER = `GET /api/v1/inventory/suppliers/${supplierId}`;
const INGREDIENTS = 'GET /api/v1/inventory/ingredients';

const mozzarella: Ingredient = {
  id: '01990000-0000-7000-8000-000000009002',
  brandId: ids.pizza,
  name: { en: 'Mozzarella', ar: 'موزاريلا' },
  unit: 'kg',
  costPerUnit: '3.000',
  lowLevel: '2.000',
  isActive: true,
};
const basil: Ingredient = {
  ...mozzarella,
  id: '01990000-0000-7000-8000-000000009003',
  name: { en: 'Basil', ar: 'ريحان' },
};

const supplier: Supplier = {
  id: supplierId,
  brandId: ids.pizza,
  name: 'Gulf Dairy',
  contactName: null,
  phone: '+965 2222 3333',
  email: null,
  address: null,
  paymentDays: 30,
  notes: null,
  isActive: true,
  priceCount: 1,
};
const supplierDetail: SupplierDetail = {
  ...supplier,
  prices: [{ ingredient: mozzarella, price: '2.800', updatedAt: '2026-10-15T08:00:00.000Z' }],
};

// Order 7 at the Mall: 10 kg of mozzarella at 2.800.
const draft: PurchaseOrder = {
  id: orderId,
  number: 7,
  brandId: ids.pizza,
  branchId: ids.pizzaMall,
  supplier: {
    id: supplierId,
    name: 'Gulf Dairy',
    contactName: null,
    phone: '+965 2222 3333',
    email: null,
  },
  branch: { id: ids.pizzaMall, name: pizzaMall.name, address: 'The Avenues, Kuwait City' },
  status: 'draft',
  expectedOn: null,
  note: null,
  total: '28.000',
  lineCount: 1,
  createdByName: 'Mall Branch Manager',
  createdAt: '2026-10-15T09:00:00.000Z',
  sentByName: null,
  sentAt: null,
  cancelledByName: null,
  cancelledAt: null,
  cancelReason: null,
  receivedByName: null,
  receivedAt: null,
  invoiceNumber: null,
  receiveNote: null,
  receivedTotal: null,
  lines: [
    {
      ingredient: mozzarella,
      quantity: '10.000',
      unitPrice: '2.800',
      lineTotal: '28.000',
      receivedQuantity: null,
      receivedPrice: null,
      receivedTotal: null,
    },
  ],
};
const sent: PurchaseOrder = {
  ...draft,
  status: 'sent',
  expectedOn: '2026-10-18',
  sentByName: 'Mall Branch Manager',
  sentAt: '2026-10-15T10:00:00.000Z',
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
let current: PurchaseOrder = draft;

function ordersApi(handlers: Record<string, MockHandler> = {}, user = manager, start = draft) {
  current = start;
  const remembered = Object.fromEntries(
    Object.entries(handlers).map(([key, handler]) => [
      key,
      async (request: Parameters<MockHandler>[0]) => {
        const response = await handler(request);
        if (key !== LIST && response.ok) current = (await response.clone().json()) as PurchaseOrder;
        return response;
      },
    ]),
  );
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(user)),
    'GET /api/v1/brands': () => json(page([pizzaBrand])),
    [`GET /api/v1/brands/${ids.pizza}/branches`]: () => json(page([pizzaMall])),
    [LIST]: () => json(page([{ ...current, lines: undefined }])),
    [ONE]: () => json(current),
    [SUPPLIERS]: () => json(page([supplier])),
    [SUPPLIER]: () => json(supplierDetail),
    [INGREDIENTS]: () => json(page([basil, mozzarella])),
    ...remembered,
  });
}

const bodiesOf = (mock: ReturnType<typeof mockApi>, key: string) =>
  mock.calls.filter((call) => call.key === key).map((call) => call.body);

describe('the purchase orders of a branch', () => {
  it('are listed with their supplier, status, total and expected day', async () => {
    ordersApi({}, manager, sent);
    renderApp('/admin/inventory/purchase-orders');

    const row = (await screen.findByRole('link', { name: 'Open order 7' })).closest(
      'tr',
    ) as HTMLElement;
    expect(row).toHaveTextContent('Gulf Dairy1 ingredient');
    expect(within(row).getByText('Sent')).toBeVisible();
    expect(within(row).getByText('28.000')).toBeVisible();
    expect(within(row).getByText('18 Oct 2026')).toBeVisible();
  });

  it('start with the supplier, take its prices, and become a draft', async () => {
    const api = ordersApi({ [CREATE]: () => json(draft, 201) });
    const user = userEvent.setup();
    renderApp('/admin/inventory/purchase-orders');

    await user.click(await screen.findByRole('link', { name: 'New order' }));
    await user.selectOptions(await screen.findByLabelText('Supplier'), 'Gulf Dairy');
    // What the supplier sells comes first, with its price.
    const options = within(await screen.findByLabelText('Add an ingredient')).getAllByRole(
      'option',
    );
    expect(options.map((option) => option.textContent)).toEqual([
      'Choose an ingredient',
      'Mozzarella · 2.800',
      'Basil',
    ]);
    await user.selectOptions(screen.getByLabelText('Add an ingredient'), mozzarella.id);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByLabelText('Unit price of Mozzarella')).toHaveValue('2.800');
    await user.type(screen.getByLabelText('Mozzarella'), '10');
    const total = screen.getByText('Total').closest('tr') as HTMLElement;
    expect(within(total).getByText('28.000')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('heading', { name: 'Purchase order 7' })).toBeVisible();
    expect(bodiesOf(api, CREATE)).toEqual([
      {
        branchId: ids.pizzaMall,
        supplierId,
        expectedOn: null,
        note: '',
        lines: [{ ingredientId: mozzarella.id, quantity: '10', unitPrice: '2.800' }],
      },
    ]);
  });

  it('show the API’s answer on the line that has no price', async () => {
    ordersApi({
      [CREATE]: () =>
        errorResponse(400, 'VALIDATION_ERROR', [
          { path: 'lines.0.unitPrice', message: 'PRICE_REQUIRED' },
        ]),
    });
    const user = userEvent.setup();
    renderApp(`/admin/inventory/purchase-orders/new?branchId=${ids.pizzaMall}`);

    await screen.findByRole('option', { name: 'Gulf Dairy' });
    await user.selectOptions(screen.getByLabelText('Supplier'), 'Gulf Dairy');
    await user.selectOptions(await screen.findByLabelText('Add an ingredient'), basil.id);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.type(screen.getByLabelText('Basil'), '1');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('This supplier has no price for it. Type one.')).toBeVisible();
    expect(screen.getByLabelText('Unit price of Basil')).toHaveAccessibleDescription(
      'This supplier has no price for it. Type one.',
    );
  });
});

describe('a purchase order', () => {
  it('is changed as a draft, then sent and printed', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const api = ordersApi({
      [UPDATE]: () => json({ ...draft, expectedOn: '2026-10-18', total: '33.600' }),
      [SEND]: () => json(sent),
    });
    const user = userEvent.setup();
    renderApp(`/admin/inventory/purchase-orders/${orderId}`);

    const quantity = await screen.findByLabelText('Mozzarella');
    await user.clear(quantity);
    await user.type(quantity, '12');
    await user.type(screen.getByLabelText('Expected delivery'), '2026-10-18');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Order sent.');
    expect(bodiesOf(api, UPDATE)).toEqual([
      {
        expectedOn: '2026-10-18',
        note: '',
        lines: [{ ingredientId: mozzarella.id, quantity: '12', unitPrice: '2.800' }],
      },
    ]);
    expect(api.count(SEND)).toBe(1);
    // A sent order is read only and prints a page for the supplier.
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    const printed = screen.getByTestId('printed-order');
    expect(printed).toHaveClass('hidden', 'print:block');
    expect(printed).toHaveTextContent('Deliver to');
    expect(printed).toHaveTextContent('The Avenues, Kuwait City');
    expect(printed).toHaveTextContent('Sent by Mall Branch Manager');
    await user.click(screen.getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalled();
    print.mockRestore();
  });

  it('is cancelled with a reason, and the answer for a closed order is shown', async () => {
    let calls = 0;
    const api = ordersApi(
      {
        [CANCEL]: () => {
          calls += 1;
          return calls === 1
            ? errorResponse(409, 'ORDER_CLOSED')
            : json({
                ...sent,
                status: 'cancelled',
                cancelledByName: 'Mall Branch Manager',
                cancelledAt: '2026-10-15T11:00:00.000Z',
                cancelReason: 'Found a better price',
              });
        },
      },
      manager,
      sent,
    );
    const user = userEvent.setup();
    renderApp(`/admin/inventory/purchase-orders/${orderId}`);

    await user.click(await screen.findByRole('button', { name: 'Cancel order' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel order' });
    await user.click(within(dialog).getByRole('button', { name: 'Confirm the cancellation' }));
    expect(within(dialog).getByText('Say why.')).toBeVisible();
    await user.type(within(dialog).getByLabelText('Why is it cancelled?'), 'Found a better price');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm the cancellation' }));
    expect(
      await within(dialog).findByText('This order was received or cancelled already.'),
    ).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Confirm the cancellation' }));
    expect(await screen.findByText(/Cancelled by Mall Branch Manager/)).toHaveTextContent(
      'Found a better price',
    );
    expect(bodiesOf(api, CANCEL).at(-1)).toEqual({ reason: 'Found a better price' });
    expect(screen.queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
  });

  it('is read only for a person who may only see the stock', async () => {
    ordersApi({}, { ...branchManager, permissions: ['branches:read', 'inventory:read'] });
    renderApp(`/admin/inventory/purchase-orders/${orderId}`);

    expect(await screen.findByRole('heading', { name: 'Purchase order 7' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('10.000')).toBeVisible();
  });

  it('is shown in Arabic', async () => {
    await i18n.changeLanguage('ar');
    ordersApi({}, manager, sent);
    renderApp(`/admin/inventory/purchase-orders/${orderId}`);

    expect(await screen.findByRole('heading', { name: 'أمر الشراء 7' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'طباعة' })).toBeVisible();
    await i18n.changeLanguage('en');
  });
});
