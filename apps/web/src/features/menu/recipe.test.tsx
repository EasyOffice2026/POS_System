import type { Ingredient, Recipe } from '@pos/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { describe, expect, it } from 'vitest';
import {
  brandManager,
  fullBrandManager,
  ids,
  page,
  pizzaBrand,
  pizzaMall,
  sessionFor,
} from '../../test/fixtures';
import {
  drinksCategory,
  itemDetail,
  itemIds,
  modifierIds,
  pizzasCategory,
  sidesCategory,
  toppingsGroup,
} from '../../test/menu-fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const REFRESH = 'POST /api/v1/auth/refresh';
const BRANDS = 'GET /api/v1/brands';
const BRANCHES = `GET /api/v1/brands/${ids.pizza}/branches`;
const CATEGORIES = 'GET /api/v1/menu/categories';
const ITEM = `GET /api/v1/menu/items/${itemIds.margherita}`;
const INGREDIENTS = 'GET /api/v1/inventory/ingredients';
const ITEM_RECIPE = `GET /api/v1/menu/items/${itemIds.margherita}/recipe`;
const PUT_ITEM_RECIPE = `PUT /api/v1/menu/items/${itemIds.margherita}/recipe`;
const MODIFIER_RECIPE = `GET /api/v1/menu/modifiers/${modifierIds.cheese}/recipe`;

const PAGE = `/admin/menu/items/${itemIds.margherita}?tab=recipe`;

const flour: Ingredient = {
  id: '01990000-0000-7000-8000-000000009001',
  brandId: ids.pizza,
  name: { en: 'Flour', ar: 'طحين' },
  unit: 'kg',
  costPerUnit: '0.400',
  lowLevel: '5.000',
  isActive: true,
};
const mozzarella: Ingredient = {
  ...flour,
  id: '01990000-0000-7000-8000-000000009002',
  name: { en: 'Mozzarella', ar: 'موزاريلا' },
  costPerUnit: '3.000',
};

// 80 g of mozzarella on a 25.000 pizza: 0.240, which is 1% of the price.
const margheritaRecipe: Recipe = {
  lines: [{ ingredient: mozzarella, quantity: '0.080', cost: '0.240' }],
  cost: '0.240',
};

function api(
  extra: Record<string, MockHandler> = {},
  user = fullBrandManager,
  recipe: Recipe = margheritaRecipe,
) {
  return mockApi({
    [REFRESH]: () => json(sessionFor(user)),
    [BRANDS]: () => json(page([pizzaBrand])),
    [BRANCHES]: () => json(page([pizzaMall])),
    [CATEGORIES]: () => json({ data: [pizzasCategory, sidesCategory, drinksCategory] }),
    [ITEM]: () => json(itemDetail({ modifierGroups: [toppingsGroup] })),
    [INGREDIENTS]: () => json(page([flour, mozzarella])),
    [ITEM_RECIPE]: () => json(recipe),
    ...extra,
  });
}

const bodyOf = (mock: ReturnType<typeof mockApi>, key: string) =>
  mock.calls.find((call) => call.key === key)?.body;

describe('the recipe of an item', () => {
  it('opens from its tab and shows each ingredient with its cost, and the share of the price', async () => {
    const user = userEvent.setup();
    api();
    renderApp(`/admin/menu/items/${itemIds.margherita}`);

    await user.click(await screen.findByRole('link', { name: 'Recipe' }));

    const row = (await screen.findByText('Mozzarella')).closest('tr') as HTMLElement;
    expect(within(row).getByLabelText('Mozzarella')).toHaveValue('0.080');
    expect(within(row).getByText('kg')).toBeInTheDocument();
    expect(within(row).getByText('0.240')).toBeInTheDocument();
    const total = screen.getByText('Cost of the ingredients').closest('tr') as HTMLElement;
    expect(within(total).getByText('0.240')).toBeInTheDocument();
    expect(within(total).getByText('1% of the price')).toBeInTheDocument();
  });

  it('adds an ingredient, types its quantity and saves the whole recipe', async () => {
    const user = userEvent.setup();
    const mock = api({
      [PUT_ITEM_RECIPE]: () =>
        json({
          lines: [
            { ingredient: mozzarella, quantity: '0.080', cost: '0.240' },
            { ingredient: flour, quantity: '0.250', cost: '0.100' },
          ],
          cost: '0.340',
        }),
    });
    renderApp(PAGE);

    await user.selectOptions(await screen.findByLabelText('Add an ingredient'), 'Flour');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.type(screen.getByLabelText('Flour'), '0.25');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Recipe saved.');
    expect(bodyOf(mock, PUT_ITEM_RECIPE)).toEqual({
      lines: [
        { ingredientId: mozzarella.id, quantity: '0.080' },
        { ingredientId: flour.id, quantity: '0.250' },
      ],
    });
    const total = screen.getByText('Cost of the ingredients').closest('tr') as HTMLElement;
    expect(within(total).getByText('0.340')).toBeInTheDocument();
    // An ingredient already on the recipe cannot be added twice.
    expect(
      within(screen.getByLabelText('Add an ingredient')).queryByRole('option', { name: 'Flour' }),
    ).not.toBeInTheDocument();
  });

  it('refuses a quantity of 0 before asking the server', async () => {
    const user = userEvent.setup();
    const mock = api();
    renderApp(PAGE);

    const quantity = await screen.findByLabelText('Mozzarella');
    await user.clear(quantity);
    await user.type(quantity, '0');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(quantity).toHaveAccessibleDescription('Type a quantity above 0, with up to 3 decimals.');
    expect(bodyOf(mock, PUT_ITEM_RECIPE)).toBeUndefined();
  });

  it('removes an ingredient and shows the API’s answer', async () => {
    const user = userEvent.setup();
    api({
      [PUT_ITEM_RECIPE]: () =>
        errorResponse(400, 'VALIDATION_ERROR', [
          { path: 'lines.0.ingredientId', message: 'INGREDIENT_NOT_FOUND' },
        ]),
    });
    renderApp(PAGE);

    await user.click(
      await screen.findByRole('button', { name: 'Remove Mozzarella from the recipe' }),
    );
    expect(
      screen.getByText('No recipe yet. The stock does not change when this is sold.'),
    ).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Add an ingredient'), 'Flour');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.type(screen.getByLabelText('Flour'), '1');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This ingredient is not available.');
  });

  it('is shown to a person who may not change the menu, with nothing to change it with', async () => {
    api({}, { ...brandManager, permissions: ['menu:read', 'inventory:read'] });
    renderApp(PAGE);

    const row = (await screen.findByText('Mozzarella')).closest('tr') as HTMLElement;
    expect(within(row).getByText('0.080')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Add an ingredient')).not.toBeInTheDocument();
  });

  it('has no tab for a person who may not see the stock', async () => {
    api({}, { ...brandManager, permissions: ['menu:read', 'menu:write'] });
    renderApp(`/admin/menu/items/${itemIds.margherita}`);

    await screen.findByRole('link', { name: 'Modifiers' });
    expect(screen.queryByRole('link', { name: 'Recipe' })).not.toBeInTheDocument();
  });

  it('shows the words of the screen in Arabic', async () => {
    await i18n.changeLanguage('ar');
    api();
    renderApp(PAGE);

    expect(await screen.findByText('موزاريلا')).toBeInTheDocument();
    expect(screen.getByText('تكلفة المكوّنات')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'حفظ' })).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });
});

describe('the recipe of a modifier', () => {
  it('opens in a dialog from the modifier and saves', async () => {
    const user = userEvent.setup();
    const mock = api({
      [MODIFIER_RECIPE]: () => json({ lines: [], cost: '0.000' }),
      [`PUT /api/v1/menu/modifiers/${modifierIds.cheese}/recipe`]: () =>
        json({
          lines: [{ ingredient: mozzarella, quantity: '0.040', cost: '0.120' }],
          cost: '0.120',
        }),
    });
    renderApp(`/admin/menu/items/${itemIds.margherita}?tab=modifiers`);

    await user.click(await screen.findByRole('button', { name: 'Recipe of Extra cheese' }));
    const dialog = await screen.findByRole('dialog', { name: 'Recipe of Extra cheese' });
    expect(
      within(dialog).getByText('No recipe yet. The stock does not change when this is sold.'),
    ).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Add an ingredient'), 'Mozzarella');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    await user.type(within(dialog).getByLabelText('Mozzarella'), '0.04');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByRole('status')).toHaveTextContent('Recipe saved.');
    expect(bodyOf(mock, `PUT /api/v1/menu/modifiers/${modifierIds.cheese}/recipe`)).toEqual({
      lines: [{ ingredientId: mozzarella.id, quantity: '0.040' }],
    });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
