import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { describe, expect, it } from 'vitest';
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
  cola,
  drinksCategory,
  margherita,
  menuItem,
  pepperoni,
  pizzasCategory,
  sidesCategory,
} from '../../test/menu-fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const REFRESH = 'POST /api/v1/auth/refresh';
const BRANDS = 'GET /api/v1/brands';
const BRANCHES = `GET /api/v1/brands/${ids.pizza}/branches`;
const CATEGORIES = 'GET /api/v1/menu/categories';
const ITEMS = 'GET /api/v1/menu/items';

function api(
  items: MockHandler = () => json(page([margherita, pepperoni, cola])),
  user: typeof fullBrandManager = fullBrandManager,
  categories: unknown[] = [pizzasCategory, sidesCategory, drinksCategory],
) {
  return mockApi({
    [REFRESH]: () => json(sessionFor(user)),
    [BRANDS]: () => json(page([pizzaBrand])),
    [BRANCHES]: () => json(page([pizzaMall, pizzaDowntown])),
    [CATEGORIES]: () => json({ data: categories }),
    [ITEMS]: items,
  });
}

const itemRequests = (mock: ReturnType<typeof mockApi>) =>
  mock.calls.filter((call) => call.key === ITEMS).map((call) => call.url.searchParams);

describe('the items of the menu', () => {
  it('opens on the items, with the name, the category, the price and the status of each', async () => {
    api();
    renderApp('/admin/menu');

    const row = (await screen.findByRole('link', { name: 'Margherita' })).closest(
      'tr',
    ) as HTMLElement;

    expect(within(row).getByText('مارجريتا')).toHaveAttribute('lang', 'ar');
    expect(within(row).getByText('Pizzas')).toBeInTheDocument();
    expect(within(row).getByText('25.000')).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Items' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('asks for the items of the brand only, a page at a time', async () => {
    const mock = api();
    renderApp('/admin/menu/items');
    await screen.findByRole('link', { name: 'Margherita' });

    const [first] = itemRequests(mock);
    expect(first?.get('brandId')).toBe(ids.pizza);
    expect(first?.get('limit')).toBe('25');
    expect(first?.has('q')).toBe(false);
    expect(first?.has('status')).toBe(false);
  });

  it('links each item to its form', async () => {
    api();
    renderApp('/admin/menu/items');

    expect(await screen.findByRole('link', { name: 'Pepperoni' })).toHaveAttribute(
      'href',
      `/admin/menu/items/${pepperoni.id}`,
    );
  });

  it('marks an item that is not active, and the category of an item that is not active', async () => {
    api(() => json(page([{ ...pepperoni, isActive: false }, cola])), fullBrandManager, [
      pizzasCategory,
      sidesCategory,
      { ...drinksCategory, isActive: false },
    ]);
    renderApp('/admin/menu/items');

    const pepperoniRow = (await screen.findByRole('link', { name: 'Pepperoni' })).closest(
      'tr',
    ) as HTMLElement;
    const colaRow = screen.getByRole('link', { name: 'Cola' }).closest('tr') as HTMLElement;

    expect(within(pepperoniRow).getByText('Inactive')).toBeInTheDocument();
    expect(within(colaRow).getByText('Drinks (inactive)')).toBeInTheDocument();
  });

  it('says so when there are no items, and when the filters match none', async () => {
    const user = userEvent.setup();
    api(() => json(page([])));
    renderApp('/admin/menu/items');

    expect(await screen.findByText('There are no items yet.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search'), 'xyz');

    expect(await screen.findByText('No item matches these filters.')).toBeInTheDocument();
  });

  it('says so when the items cannot be loaded', async () => {
    api(() => errorResponse(500, 'INTERNAL_ERROR'));
    renderApp('/admin/menu/items');

    expect(await screen.findByText('Could not load the data.')).toBeInTheDocument();
  });

  it('shows the names in Arabic first, with the English name under them', async () => {
    await i18n.changeLanguage('ar');
    api();
    renderApp('/admin/menu/items');

    const row = (await screen.findByRole('link', { name: 'مارجريتا' })).closest(
      'tr',
    ) as HTMLElement;

    expect(within(row).getByText('Margherita')).toHaveAttribute('lang', 'en');
    expect(within(row).getByText('البيتزا')).toBeInTheDocument();
    expect(within(row).getByText('د.ك', { exact: false })).toBeInTheDocument();
  });
});

describe('searching and filtering the items', () => {
  it('searches in the name, as typed, in either language', async () => {
    const user = userEvent.setup();
    const mock = api(({ url }) =>
      json(
        page(url.searchParams.get('q') === 'بيتزا' ? [pepperoni] : [margherita, pepperoni, cola]),
      ),
    );
    renderApp('/admin/menu/items');
    await screen.findByRole('link', { name: 'Margherita' });

    await user.type(screen.getByLabelText('Search'), 'بيتزا');

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Margherita' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'Pepperoni' })).toBeInTheDocument();
    expect(itemRequests(mock).at(-1)?.get('q')).toBe('بيتزا');
  });

  it('leaves out the spaces around what is typed', async () => {
    const user = userEvent.setup();
    const mock = api();
    renderApp('/admin/menu/items');
    await screen.findByRole('link', { name: 'Margherita' });

    await user.type(screen.getByLabelText('Search'), '  pizza  ');

    await waitFor(() => expect(itemRequests(mock).at(-1)?.get('q')).toBe('pizza'));
  });

  it('filters by category, with the categories of the brand to choose from', async () => {
    const user = userEvent.setup();
    const mock = api(({ url }) =>
      json(
        page(
          url.searchParams.get('categoryId') === categoryIds.drinks ? [cola] : [margherita, cola],
        ),
      ),
    );
    renderApp('/admin/menu/items');
    await screen.findByRole('link', { name: 'Margherita' });
    await screen.findByRole('option', { name: 'Drinks' });
    const filter = screen.getByLabelText('Category');
    expect(
      within(filter)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['All', 'Pizzas', 'Sides', 'Drinks']);

    await user.selectOptions(filter, categoryIds.drinks);

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Margherita' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'Cola' })).toBeInTheDocument();
    expect(itemRequests(mock).at(-1)?.get('categoryId')).toBe(categoryIds.drinks);
  });

  it('filters by status', async () => {
    const user = userEvent.setup();
    const mock = api(({ url }) =>
      json(
        page(
          url.searchParams.get('status') === 'inactive'
            ? [{ ...cola, isActive: false }]
            : [margherita, cola],
        ),
      ),
    );
    renderApp('/admin/menu/items');
    await screen.findByRole('link', { name: 'Margherita' });

    await user.selectOptions(screen.getByLabelText('Status'), 'inactive');

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Margherita' })).not.toBeInTheDocument(),
    );
    expect(itemRequests(mock).at(-1)?.get('status')).toBe('inactive');
  });

  it('combines the filters, and asks for everything again when they are cleared', async () => {
    const user = userEvent.setup();
    const mock = api();
    renderApp('/admin/menu/items');
    await screen.findByRole('link', { name: 'Margherita' });

    await user.selectOptions(screen.getByLabelText('Category'), categoryIds.pizzas);
    await user.selectOptions(screen.getByLabelText('Status'), 'active');
    await waitFor(() => expect(itemRequests(mock).at(-1)?.get('status')).toBe('active'));
    expect(itemRequests(mock).at(-1)?.get('categoryId')).toBe(categoryIds.pizzas);

    await user.selectOptions(screen.getByLabelText('Category'), '');
    await user.selectOptions(screen.getByLabelText('Status'), '');

    await waitFor(() => expect(itemRequests(mock).at(-1)?.has('status')).toBe(false));
    expect(itemRequests(mock).at(-1)?.has('categoryId')).toBe(false);
  });

  it('loads the next page when asked, and keeps the ones already shown', async () => {
    const user = userEvent.setup();
    const next = menuItem({
      id: '01990000-0000-7000-8000-000000000509',
      name: { en: 'Tiramisu', ar: 'تيراميسو' },
    });
    const mock = api(({ url }) =>
      url.searchParams.get('cursor') ? json(page([next])) : json(page([margherita], margherita.id)),
    );
    renderApp('/admin/menu/items');
    await screen.findByRole('link', { name: 'Margherita' });

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByRole('link', { name: 'Tiramisu' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Margherita' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(itemRequests(mock).at(-1)?.get('cursor')).toBe(margherita.id);
  });
});

describe('adding an item from the list', () => {
  it('offers a new item to a person who may change the menu, in the category that is filtered', async () => {
    const user = userEvent.setup();
    api();
    renderApp('/admin/menu/items');
    const link = await screen.findByRole('link', { name: 'New item' });
    expect(link).toHaveAttribute('href', `/admin/menu/items/new?brandId=${ids.pizza}`);

    await screen.findByRole('option', { name: 'Drinks' });
    await user.selectOptions(screen.getByLabelText('Category'), categoryIds.drinks);

    expect(screen.getByRole('link', { name: 'New item' })).toHaveAttribute(
      'href',
      `/admin/menu/items/new?brandId=${ids.pizza}&categoryId=${categoryIds.drinks}`,
    );
  });

  it('sends a person to the categories first when the brand has none', async () => {
    api(() => json(page([])), fullBrandManager, []);
    renderApp('/admin/menu/items');

    expect(
      await screen.findByText(/Add a category first: every item belongs to a category\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to categories' })).toHaveAttribute(
      'href',
      '/admin/menu/categories',
    );
    expect(screen.queryByRole('link', { name: 'New item' })).not.toBeInTheDocument();
  });

  it('shows a person who cannot change the menu the list without a new item', async () => {
    api(undefined, { ...brandManager });
    renderApp('/admin/menu/items');

    await screen.findByRole('link', { name: 'Margherita' });

    expect(screen.queryByRole('link', { name: 'New item' })).not.toBeInTheDocument();
  });
});
