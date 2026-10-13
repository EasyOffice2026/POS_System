import type { Ingredient, SupplierDetail } from '@pos/shared';
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
  pizzaMall,
  sessionFor,
} from '../../test/fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const supplierId = '01990000-0000-7000-8000-00000000d001';
const LIST = 'GET /api/v1/inventory/suppliers';
const CREATE = 'POST /api/v1/inventory/suppliers';
const ONE = `GET /api/v1/inventory/suppliers/${supplierId}`;
const PATCH = `PATCH /api/v1/inventory/suppliers/${supplierId}`;
const PRICES = `PUT /api/v1/inventory/suppliers/${supplierId}/prices`;
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
const flour: Ingredient = {
  ...mozzarella,
  id: '01990000-0000-7000-8000-000000009001',
  name: { en: 'Flour', ar: 'طحين' },
  costPerUnit: '0.400',
};

const dairy: SupplierDetail = {
  id: supplierId,
  brandId: ids.pizza,
  name: 'Gulf Dairy',
  contactName: 'Ahmad',
  phone: '+965 2222 3333',
  email: 'orders@gulfdairy.kw',
  address: null,
  paymentDays: 30,
  notes: null,
  isActive: true,
  priceCount: 1,
  prices: [{ ingredient: mozzarella, price: '2.800', updatedAt: '2026-10-15T08:00:00.000Z' }],
};

// The Mall's purchaser: sees the suppliers, changes nothing.
const purchaser = {
  ...branchManager,
  permissions: ['branches:read' as const, 'inventory:read' as const, 'inventory:write' as const],
};

// The supplier as the server has it now: a change is what GET answers next.
let current: SupplierDetail = dairy;

function suppliersApi(user = fullBrandManager, handlers: Record<string, MockHandler> = {}) {
  current = dairy;
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(user)),
    'GET /api/v1/brands': () => json(page([pizzaBrand])),
    [`GET /api/v1/brands/${ids.pizza}/branches`]: () => json(page([pizzaMall])),
    [LIST]: () => json(page([dairy])),
    [ONE]: () => json(current),
    [INGREDIENTS]: () => json(page([flour, mozzarella])),
    ...handlers,
  });
}

const bodyOf = (mock: ReturnType<typeof mockApi>, key: string) =>
  mock.calls.find((call) => call.key === key)?.body;

describe('the suppliers', () => {
  it('are listed with their phone, days to pay and prices, and searched', async () => {
    const api = suppliersApi();
    const user = userEvent.setup();
    renderApp('/admin/inventory/suppliers');

    const row = (await screen.findByRole('link', { name: 'Gulf Dairy' })).closest(
      'li',
    ) as HTMLElement;
    expect(row).toHaveTextContent('+965 2222 3333 · 30 days to pay · 1 price');
    await user.type(screen.getByLabelText('Search'), 'gulf');
    expect(api.calls.at(-1)?.url.searchParams.get('q')).toBe('gulf');
  });

  it('are added by the brand manager, who lands on the new supplier', async () => {
    const api = suppliersApi(fullBrandManager, {
      [LIST]: () => json(page([])),
      [CREATE]: () => json(dairy, 201),
    });
    const user = userEvent.setup();
    renderApp('/admin/inventory/suppliers');

    expect(await screen.findByText('No supplier yet.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Add a supplier' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription("Enter the supplier's name.");

    await user.type(screen.getByLabelText('Name'), 'Gulf Dairy');
    await user.type(screen.getByLabelText('Phone'), 'call me');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByLabelText('Phone')).toHaveAccessibleDescription(
      'Type a phone number with digits, spaces, + and - only.',
    );

    await user.clear(screen.getByLabelText('Phone'));
    await user.type(screen.getByLabelText('Phone'), '+965 2222 3333');
    await user.clear(screen.getByLabelText('Days to pay'));
    await user.type(screen.getByLabelText('Days to pay'), '30');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('heading', { name: 'Gulf Dairy' })).toBeVisible();
    expect(bodyOf(api, CREATE)).toEqual({
      brandId: ids.pizza,
      name: 'Gulf Dairy',
      contactName: '',
      phone: '+965 2222 3333',
      email: '',
      address: '',
      paymentDays: 30,
      notes: '',
    });
  });

  it('shows the answer when the name is taken', async () => {
    suppliersApi(fullBrandManager, {
      [CREATE]: () =>
        errorResponse(400, 'VALIDATION_ERROR', [{ path: 'name', message: 'SUPPLIER_NAME_TAKEN' }]),
    });
    const user = userEvent.setup();
    renderApp('/admin/inventory/suppliers');

    await user.click(await screen.findByRole('button', { name: 'Add a supplier' }));
    await user.type(screen.getByLabelText('Name'), 'gulf dairy');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('The brand already has a supplier with this name.'),
    ).toBeVisible();
  });

  it('cannot be added by the purchaser', async () => {
    suppliersApi(purchaser);
    renderApp('/admin/inventory/suppliers');
    expect(await screen.findByRole('link', { name: 'Gulf Dairy' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add a supplier' })).not.toBeInTheDocument();
  });
});

describe('a supplier', () => {
  it('shows its details and its prices next to the ingredient cost', async () => {
    suppliersApi();
    renderApp(`/admin/inventory/suppliers/${supplierId}`);

    expect(await screen.findByRole('heading', { name: 'Gulf Dairy' })).toBeVisible();
    expect(screen.getByText('Ahmad')).toBeVisible();
    expect(screen.getByText('30 days to pay')).toBeVisible();
    const row = screen.getByLabelText('Mozzarella').closest('tr') as HTMLElement;
    expect(within(row).getByLabelText('Mozzarella')).toHaveValue('2.800');
    expect(within(row).getByText('3.000')).toBeVisible();
    expect(within(row).getByText('7% cheaper')).toHaveClass('text-emerald-800');
  });

  it('saves a price list with a new ingredient', async () => {
    const api = suppliersApi(fullBrandManager, {
      [PRICES]: () =>
        json({
          ...dairy,
          priceCount: 2,
          prices: [
            { ingredient: flour, price: '0.500', updatedAt: '2026-10-15T09:00:00.000Z' },
            ...dairy.prices,
          ],
        }),
    });
    const user = userEvent.setup();
    renderApp(`/admin/inventory/suppliers/${supplierId}`);

    await user.selectOptions(await screen.findByLabelText('Add an ingredient'), 'Flour');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'Save prices' }));
    expect(screen.getByLabelText('Flour')).toHaveAccessibleDescription(
      'Enter a number with at most 3 decimals, for example 12.500.',
    );

    await user.type(screen.getByLabelText('Flour'), '0.5');
    const row = screen.getByLabelText('Flour').closest('tr') as HTMLElement;
    expect(within(row).getByText('25% dearer')).toHaveClass('text-red-700');
    await user.click(screen.getByRole('button', { name: 'Save prices' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Prices saved.');
    expect(bodyOf(api, PRICES)).toEqual({
      prices: [
        { ingredientId: mozzarella.id, price: '2.800' },
        { ingredientId: flour.id, price: '0.500' },
      ],
    });
  });

  it('is changed and deactivated by the brand manager', async () => {
    const api = suppliersApi(fullBrandManager, {
      [PATCH]: ({ body }) => json((current = { ...current, ...(body as object) })),
    });
    const user = userEvent.setup();
    renderApp(`/admin/inventory/suppliers/${supplierId}`);

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('Contact person'));
    await user.type(screen.getByLabelText('Contact person'), 'Sara');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Sara')).toBeVisible();
    expect(bodyOf(api, PATCH)).toMatchObject({ name: 'Gulf Dairy', contactName: 'Sara' });

    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByRole('button', { name: 'Activate' })).toBeVisible();
  });

  it('is read only for the purchaser', async () => {
    suppliersApi(purchaser);
    renderApp(`/admin/inventory/suppliers/${supplierId}`);

    expect(await screen.findByRole('heading', { name: 'Gulf Dairy' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Add an ingredient')).not.toBeInTheDocument();
    expect(screen.getByText('Mozzarella')).toBeVisible();
  });

  it('is shown in Arabic', async () => {
    await i18n.changeLanguage('ar');
    suppliersApi();
    renderApp(`/admin/inventory/suppliers/${supplierId}`);

    expect(await screen.findByRole('heading', { name: 'Gulf Dairy' })).toBeVisible();
    expect(screen.getByText('مهلة دفع 30 يومًا')).toBeVisible();
    expect(screen.getByRole('button', { name: 'حفظ الأسعار' })).toBeVisible();
    await i18n.changeLanguage('en');
  });
});
