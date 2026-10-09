import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import {
  brandManager,
  fullBrandManager,
  ids,
  page,
  pizzaBrand,
  pizzaDowntown,
  pizzaMall,
  sessionFor,
} from '../../test/fixtures';
import {
  categoryIds,
  drinksCategory,
  menuCategory,
  pizzasCategory,
  sidesCategory,
} from '../../test/menu-fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const REFRESH = 'POST /api/v1/auth/refresh';
const BRANDS = 'GET /api/v1/brands';
const BRANCHES = `GET /api/v1/brands/${ids.pizza}/branches`;
const LIST = 'GET /api/v1/menu/categories';
const CREATE = 'POST /api/v1/menu/categories';
const ORDER = 'PUT /api/v1/menu/categories/order';
const patch = (id: string) => `PATCH /api/v1/menu/categories/${id}`;

const threeCategories = [pizzasCategory, sidesCategory, drinksCategory];

function api(
  extra: Record<string, MockHandler> = {},
  options: { user?: typeof fullBrandManager; categories?: unknown[] } = {},
) {
  return mockApi({
    [REFRESH]: () => json(sessionFor(options.user ?? fullBrandManager)),
    [BRANDS]: () => json(page([pizzaBrand])),
    [BRANCHES]: () => json(page([pizzaMall, pizzaDowntown])),
    [LIST]: () => json({ data: options.categories ?? threeCategories }),
    ...extra,
  });
}

const bodyOf = (mock: ReturnType<typeof mockApi>, key: string) =>
  mock.calls.find((call) => call.key === key)?.body;

const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement;
const namesInOrder = () =>
  screen.getAllByRole('listitem').map((row) => row.querySelector('p')?.textContent);

describe('the categories of the menu', () => {
  it('lists them in order, with the name in the other language under each name', async () => {
    api();
    renderApp('/admin/menu/categories');

    expect(await screen.findByText('Pizzas')).toBeInTheDocument();
    expect(namesInOrder()).toEqual(['Pizzas', 'Sides', 'Drinks']);
    expect(within(rowOf('Pizzas')).getByText('البيتزا')).toHaveAttribute('lang', 'ar');
  });

  it('asks for the categories of the brand, and the menu opens on this section', async () => {
    const mock = api();
    renderApp('/admin/menu');

    await screen.findByText('Pizzas');

    const call = mock.calls.find((item) => item.key === LIST);
    expect(call?.url.searchParams.get('brandId')).toBe(ids.pizza);
    expect(screen.getByRole('link', { name: 'Categories' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('marks a category that is not active', async () => {
    api({}, { categories: [pizzasCategory, { ...sidesCategory, isActive: false }] });
    renderApp('/admin/menu/categories');

    await screen.findByText('Pizzas');

    expect(within(rowOf('Sides')).getByText('Inactive')).toBeInTheDocument();
    expect(within(rowOf('Pizzas')).getByText('Active')).toBeInTheDocument();
  });

  it('says so when there are no categories', async () => {
    api({}, { categories: [] });
    renderApp('/admin/menu/categories');

    expect(await screen.findByText('There are no categories yet.')).toBeInTheDocument();
  });

  it('says so when the list cannot be loaded', async () => {
    api({ [LIST]: () => errorResponse(500, 'INTERNAL_ERROR') });
    renderApp('/admin/menu/categories');

    expect(await screen.findByText('Could not load the data.')).toBeInTheDocument();
  });

  it('shows a person who cannot change the menu the list, and nothing to change it with', async () => {
    api({}, { user: { ...brandManager } });
    renderApp('/admin/menu/categories');

    await screen.findByText('Pizzas');

    expect(screen.getByText('You can see the menu but you cannot change it.')).toBeInTheDocument();
    expect(within(screen.getByRole('main')).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Add a category' })).not.toBeInTheDocument();
    expect(rowOf('Pizzas')).toHaveAttribute('draggable', 'false');
  });

  it('shows the names and the buttons in Arabic', async () => {
    await i18n.changeLanguage('ar');
    api();
    renderApp('/admin/menu/categories');

    const row = (await screen.findByText('البيتزا')).closest('li') as HTMLElement;

    expect(within(row).getByText('Pizzas')).toHaveAttribute('lang', 'en');
    expect(within(row).getByRole('button', { name: 'تعديل البيتزا' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'نقل البيتزا إلى الأسفل' })).toBeInTheDocument();
  });
});

describe('adding a category', () => {
  const dessert = menuCategory({
    id: '01990000-0000-7000-8000-000000000404',
    name: { en: 'Desserts', ar: 'الحلويات' },
    sortOrder: 3,
  });

  async function fill(user: ReturnType<typeof userEvent.setup>, en: string, ar: string) {
    await user.type(await screen.findByLabelText('Name (English)'), en);
    await user.type(screen.getByLabelText('Name (Arabic)'), ar);
  }

  it('sends both names and the brand, and puts the new category at the end', async () => {
    const user = userEvent.setup();
    const mock = api({ [CREATE]: () => json(dessert, 201) });
    renderApp('/admin/menu/categories');
    await screen.findByText('Pizzas');
    await fill(user, 'Desserts', 'الحلويات');

    await user.click(screen.getByRole('button', { name: 'Add category' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Category added.');
    expect(bodyOf(mock, CREATE)).toEqual({
      brandId: ids.pizza,
      name: { en: 'Desserts', ar: 'الحلويات' },
    });
    expect(namesInOrder()).toEqual(['Pizzas', 'Sides', 'Drinks', 'Desserts']);
    expect(screen.getByLabelText('Name (English)')).toHaveValue('');
    expect(screen.getByLabelText('Name (Arabic)')).toHaveValue('');
  });

  it('asks for both names before sending anything, and says which one is missing', async () => {
    const user = userEvent.setup();
    const mock = api();
    renderApp('/admin/menu/categories');
    await screen.findByText('Pizzas');
    await user.type(screen.getByLabelText('Name (English)'), 'Desserts');

    await user.click(screen.getByRole('button', { name: 'Add category' }));

    expect(screen.getByLabelText('Name (Arabic)')).toHaveAccessibleDescription(
      'Enter the name in this language.',
    );
    expect(mock.count(CREATE)).toBe(0);
  });

  it('shows a problem the server finds on the field that has it', async () => {
    const user = userEvent.setup();
    api({
      [CREATE]: () =>
        errorResponse(400, 'VALIDATION_ERROR', [{ path: 'name.ar', message: 'NAME_TOO_LONG' }]),
    });
    renderApp('/admin/menu/categories');
    await screen.findByText('Pizzas');
    await fill(user, 'Desserts', 'الحلويات');

    await user.click(screen.getByRole('button', { name: 'Add category' }));

    expect(await screen.findByText('A name can have at most 100 characters.')).toBeInTheDocument();
    expect(screen.getByLabelText('Name (Arabic)')).toHaveAttribute('aria-invalid', 'true');
  });

  it('says so when the brand has reached the limit of categories', async () => {
    const user = userEvent.setup();
    api({ [CREATE]: () => errorResponse(409, 'CATEGORY_LIMIT') });
    renderApp('/admin/menu/categories');
    await screen.findByText('Pizzas');
    await fill(user, 'Desserts', 'الحلويات');

    await user.click(screen.getByRole('button', { name: 'Add category' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A brand can have at most 500 categories.',
    );
  });
});

describe('changing a category', () => {
  it('opens the names for editing, and sends only the names when they changed', async () => {
    const user = userEvent.setup();
    const renamed = { ...pizzasCategory, name: { en: 'Pizza', ar: 'البيتزا' } };
    const mock = api({ [patch(categoryIds.pizzas)]: () => json(renamed) });
    renderApp('/admin/menu/categories');
    await screen.findByText('Pizzas');

    await user.click(screen.getByRole('button', { name: 'Edit Pizzas' }));
    const english = screen.getAllByLabelText('Name (English)')[0] as HTMLElement;
    expect(english).toHaveValue('Pizzas');
    await user.clear(english);
    await user.type(english, 'Pizza');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Category saved.');
    expect(bodyOf(mock, patch(categoryIds.pizzas))).toEqual({
      name: { en: 'Pizza', ar: 'البيتزا' },
    });
    expect(namesInOrder()).toEqual(['Pizza', 'Sides', 'Drinks']);
  });

  it('closes the editor without a request when nothing changed, or when it is cancelled', async () => {
    const user = userEvent.setup();
    const mock = api();
    renderApp('/admin/menu/categories');
    await screen.findByText('Pizzas');

    await user.click(screen.getByRole('button', { name: 'Edit Pizzas' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit Sides' }));
    await user.type(screen.getAllByLabelText('Name (English)')[0] as HTMLElement, ' and more');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText('Sides')).toBeInTheDocument();
    expect(mock.calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
  });

  it('shows a problem the server finds when saving a name', async () => {
    const user = userEvent.setup();
    api({
      [patch(categoryIds.pizzas)]: () =>
        errorResponse(400, 'VALIDATION_ERROR', [{ path: 'name.en', message: 'NAME_TOO_LONG' }]),
    });
    renderApp('/admin/menu/categories');
    await screen.findByText('Pizzas');

    await user.click(screen.getByRole('button', { name: 'Edit Pizzas' }));
    await user.type(screen.getAllByLabelText('Name (English)')[0] as HTMLElement, '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('A name can have at most 100 characters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('deactivates a category and activates it again, and never deletes it', async () => {
    const user = userEvent.setup();
    let isActive = true;
    const mock = api({
      [patch(categoryIds.drinks)]: () => {
        isActive = !isActive;
        return json({ ...drinksCategory, isActive });
      },
    });
    renderApp('/admin/menu/categories');
    await screen.findByText('Drinks');
    expect(screen.queryByRole('button', { name: /delete|remove/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Deactivate Drinks' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Category deactivated. Its items are not on the terminals any more.',
    );
    expect(bodyOf(mock, patch(categoryIds.drinks))).toEqual({ isActive: false });
    expect(within(rowOf('Drinks')).getByText('Inactive')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Activate Drinks' }));

    expect(await screen.findByText('The category is active again.')).toBeInTheDocument();
    expect(within(rowOf('Drinks')).getByText('Active')).toBeInTheDocument();
  });

  it('says so when a category could not be changed', async () => {
    const user = userEvent.setup();
    api({ [patch(categoryIds.drinks)]: () => errorResponse(404, 'NOT_FOUND') });
    renderApp('/admin/menu/categories');
    await screen.findByText('Drinks');

    await user.click(screen.getByRole('button', { name: 'Deactivate Drinks' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This category does not exist in this brand.',
    );
  });
});

describe('the order of the categories', () => {
  const reordered = (order: typeof threeCategories) => ({
    data: order.map((category, index) => ({ ...category, sortOrder: index })),
  });

  it('moves a category down with its arrow, and saves the order of all of them', async () => {
    const user = userEvent.setup();
    const mock = api({
      [ORDER]: () => json(reordered([sidesCategory, pizzasCategory, drinksCategory])),
    });
    renderApp('/admin/menu/categories');
    await screen.findByText('Pizzas');

    await user.click(screen.getByRole('button', { name: 'Move Pizzas down' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The new order is saved.');
    expect(bodyOf(mock, ORDER)).toEqual({
      brandId: ids.pizza,
      ids: [categoryIds.sides, categoryIds.pizzas, categoryIds.drinks],
    });
    expect(namesInOrder()).toEqual(['Sides', 'Pizzas', 'Drinks']);
  });

  it('moves a category up, and has no arrow up on the first or down on the last', async () => {
    const user = userEvent.setup();
    const mock = api({
      [ORDER]: () => json(reordered([pizzasCategory, drinksCategory, sidesCategory])),
    });
    renderApp('/admin/menu/categories');
    await screen.findByText('Pizzas');

    expect(screen.getByRole('button', { name: 'Move Pizzas up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Drinks down' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Move Drinks up' }));

    await screen.findByRole('status');
    expect(bodyOf(mock, ORDER)).toMatchObject({
      ids: [categoryIds.pizzas, categoryIds.drinks, categoryIds.sides],
    });
  });

  it('moves a category to the place where it is dropped', async () => {
    const mock = api({
      [ORDER]: () => json(reordered([sidesCategory, drinksCategory, pizzasCategory])),
    });
    renderApp('/admin/menu/categories');
    await screen.findByText('Pizzas');
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };

    expect(rowOf('Pizzas')).toHaveAttribute('draggable', 'true');
    fireEvent.dragStart(rowOf('Pizzas'), { dataTransfer });
    fireEvent.dragOver(rowOf('Drinks'), { dataTransfer });
    fireEvent.drop(rowOf('Drinks'), { dataTransfer });

    await screen.findByRole('status');
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', categoryIds.pizzas);
    expect(bodyOf(mock, ORDER)).toMatchObject({
      ids: [categoryIds.sides, categoryIds.drinks, categoryIds.pizzas],
    });
    expect(namesInOrder()).toEqual(['Sides', 'Drinks', 'Pizzas']);
  });

  it('ignores something dropped that was not dragged from the list, and a drop on itself', async () => {
    const mock = api();
    renderApp('/admin/menu/categories');
    await screen.findByText('Pizzas');
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };

    fireEvent.drop(rowOf('Drinks'), { dataTransfer });
    fireEvent.dragStart(rowOf('Sides'), { dataTransfer });
    fireEvent.drop(rowOf('Sides'), { dataTransfer });

    expect(mock.count(ORDER)).toBe(0);
    expect(namesInOrder()).toEqual(['Pizzas', 'Sides', 'Drinks']);
  });

  it('puts the order back and says so when it could not be saved', async () => {
    const user = userEvent.setup();
    api({
      [ORDER]: () =>
        errorResponse(400, 'VALIDATION_ERROR', [{ path: 'ids', message: 'ORDER_MISMATCH' }]),
    });
    renderApp('/admin/menu/categories');
    await screen.findByText('Pizzas');

    await user.click(screen.getByRole('button', { name: 'Move Pizzas down' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The categories changed in the meantime. Reload the page and try again.',
    );
    await waitFor(() => expect(namesInOrder()).toEqual(['Pizzas', 'Sides', 'Drinks']));
  });
});
