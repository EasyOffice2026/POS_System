import type { BranchStock, Ingredient, StockMovement } from '@pos/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const INGREDIENTS = 'GET /api/v1/inventory/ingredients';
const STOCK = 'GET /api/v1/inventory/stock';
const MOVEMENTS = 'GET /api/v1/inventory/movements';
const RECORD = 'POST /api/v1/inventory/movements';

const flour: Ingredient = {
  id: '01990000-0000-7000-8000-000000009001',
  brandId: ids.pizza,
  name: { en: 'Flour', ar: 'طحين' },
  unit: 'kg',
  costPerUnit: '0.400',
  lowLevel: '5.000',
  isActive: true,
};
const cheese: Ingredient = {
  ...flour,
  id: '01990000-0000-7000-8000-000000009002',
  name: { en: 'Mozzarella', ar: 'موزاريلا' },
  costPerUnit: '3.000',
  lowLevel: '2.000',
};

const stockOf = (ingredient: Ingredient, quantity: string, isLow: boolean): BranchStock => ({
  branchId: ids.pizzaMall,
  ingredient,
  quantity,
  lowLevel: null,
  isLow,
  value: (Number(quantity) * Number(ingredient.costPerUnit)).toFixed(3),
});

const movement: StockMovement = {
  id: '01990000-0000-7000-8000-00000000a901',
  branchId: ids.pizzaMall,
  ingredientId: flour.id,
  kind: 'waste',
  quantity: '-2.500',
  quantityAfter: '17.500',
  note: 'Dropped a bag',
  referenceId: null,
  byId: branchManager.id,
  byName: 'Mall Branch Manager',
  createdAt: '2026-10-14T09:00:00.000Z',
};

const manager = {
  ...branchManager,
  permissions: [
    ...branchManager.permissions,
    'inventory:read' as const,
    'inventory:write' as const,
  ],
};

function inventoryApi(user = fullBrandManager, handlers: Record<string, MockHandler> = {}) {
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(user)),
    'GET /api/v1/brands': () => json(page([pizzaBrand])),
    [`GET /api/v1/brands/${ids.pizza}/branches`]: () => json(page([pizzaMall, pizzaDowntown])),
    [INGREDIENTS]: () => json(page([flour, cheese])),
    [STOCK]: () =>
      json({ data: [stockOf(flour, '4.000', true), stockOf(cheese, '10.000', false)] }),
    [MOVEMENTS]: () => json(page([movement])),
    ...handlers,
  });
}

describe('the ingredients', () => {
  it('are listed and searched, and a brand manager adds one', async () => {
    const api = inventoryApi(fullBrandManager, {
      'POST /api/v1/inventory/ingredients': (request) =>
        json(
          { ...flour, id: '01990000-0000-7000-8000-000000009003', ...(request.body as object) },
          201,
        ),
    });
    const user = userEvent.setup();
    renderApp('/admin/inventory/ingredients');

    expect(await screen.findByText('Flour')).toBeVisible();
    expect(screen.getByText('Mozzarella')).toBeVisible();
    await user.type(screen.getByLabelText('Search'), 'moz');
    expect(api.calls.at(-1)?.url.searchParams.get('q')).toBe('moz');

    await user.click(screen.getByRole('button', { name: 'Add an ingredient' }));
    await user.type(screen.getByLabelText('Name (English)'), 'Tomato sauce');
    await user.type(screen.getByLabelText('Name (Arabic)'), 'صلصة طماطم');
    await user.selectOptions(screen.getByLabelText('Unit'), 'l');
    await user.clear(screen.getByLabelText('Cost of one unit'));
    await user.type(screen.getByLabelText('Cost of one unit'), '1.2');
    await user.clear(screen.getByLabelText('Low below'));
    await user.type(screen.getByLabelText('Low below'), '3');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      api.calls.find((call) => call.key === 'POST /api/v1/inventory/ingredients')?.body,
    ).toEqual({
      brandId: ids.pizza,
      name: { en: 'Tomato sauce', ar: 'صلصة طماطم' },
      unit: 'l',
      costPerUnit: '1.200',
      lowLevel: '3.000',
      isActive: true,
    });
  });

  it('cannot be added by a branch manager', async () => {
    inventoryApi(manager);
    renderApp('/admin/inventory/ingredients');
    expect(await screen.findByText('Flour')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add an ingredient' })).not.toBeInTheDocument();
  });
});

describe('the stock of a branch', () => {
  it('shows the low ingredients marked and the value of the stock', async () => {
    inventoryApi(manager);
    renderApp('/admin/inventory/stock');

    const rows = await screen.findAllByRole('row');
    expect(within(rows[1] as HTMLElement).getByText('Flour')).toBeVisible();
    expect(within(rows[1] as HTMLElement).getByText('Low')).toBeVisible();
    expect(within(rows[2] as HTMLElement).queryByText('Low')).not.toBeInTheDocument();
    expect(screen.getByText('Value of the stock').nextElementSibling).toHaveTextContent('31.600');
  });

  it('shows a quantity below zero in red (more was sold than received)', async () => {
    inventoryApi(manager, {
      [STOCK]: () => json({ data: [stockOf(cheese, '-0.140', true)] }),
    });
    renderApp('/admin/inventory/stock');

    const quantity = await screen.findByText('-0.140');
    expect(quantity.closest('td')).toHaveClass('text-red-700');
  });

  it('records goods received and shows the API’s answer for too much waste', async () => {
    let calls = 0;
    const api = inventoryApi(manager, {
      [RECORD]: () => {
        calls += 1;
        return calls === 1
          ? json(stockOf(flour, '24.000', false))
          : errorResponse(400, 'VALIDATION_ERROR', [
              { path: 'quantity', message: 'STOCK_NEGATIVE' },
            ]);
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/inventory/stock');

    await user.click(await screen.findByRole('button', { name: 'Received: Flour' }));
    const receive = screen.getByRole('dialog', { name: 'Received: Flour' });
    expect(within(receive).getByText('In stock now: 4.000 kg.')).toBeVisible();
    await user.type(within(receive).getByLabelText('Quantity (kg)'), '20');
    await user.click(within(receive).getByRole('button', { name: 'Save' }));
    expect(api.calls.find((call) => call.key === RECORD)?.body).toEqual({
      branchId: ids.pizzaMall,
      ingredientId: flour.id,
      kind: 'received',
      quantity: '20',
    });

    await user.click(await screen.findByRole('button', { name: 'Waste: Flour' }));
    const waste = screen.getByRole('dialog', { name: 'Waste: Flour' });
    await user.type(within(waste).getByLabelText('Quantity (kg)'), '30');
    await user.click(within(waste).getByRole('button', { name: 'Save' }));
    expect(await within(waste).findByText('Say why.')).toBeVisible();
    await user.type(within(waste).getByLabelText('Reason'), 'Oops');
    await user.click(within(waste).getByRole('button', { name: 'Save' }));
    expect(await within(waste).findByText('There is not that much in stock.')).toBeVisible();
  });
});

describe('the movements', () => {
  it('list the history with who did what', async () => {
    inventoryApi(manager);
    renderApp('/admin/inventory/movements');

    const rows = await screen.findAllByRole('row');
    expect(within(rows[1] as HTMLElement).getByText('Waste')).toBeVisible();
    expect(
      within(rows[1] as HTMLElement)
        .getByText('-2.500')
        .closest('td'),
    ).toHaveClass('text-red-700');
    expect(within(rows[1] as HTMLElement).getByText('Mall Branch Manager')).toBeVisible();
    expect(within(rows[1] as HTMLElement).getByText('Dropped a bag')).toBeVisible();
  });
});
