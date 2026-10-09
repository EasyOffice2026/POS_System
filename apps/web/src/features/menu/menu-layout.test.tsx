import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  burgerAirport,
  burgerBrand,
  cashier,
  fullBrandManager,
  groupAdmin,
  ids,
  page,
  pizzaBrand,
  pizzaMall,
  sessionFor,
} from '../../test/fixtures';
import { menuCategory, pizzasCategory } from '../../test/menu-fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const REFRESH = 'POST /api/v1/auth/refresh';
const BRANDS = 'GET /api/v1/brands';
const branchesOf = (brandId: string) => `GET /api/v1/brands/${brandId}/branches`;
const LIST = 'GET /api/v1/menu/categories';

const burgersCategory = menuCategory({
  id: '01990000-0000-7000-8000-000000000411',
  brandId: ids.burger,
  name: { en: 'Burgers', ar: 'البرجر' },
});

// Each brand has its own categories, as the API gives them for ?brandId=.
const categoriesByBrand: MockHandler = ({ url }) =>
  json({
    data: url.searchParams.get('brandId') === ids.burger ? [burgersCategory] : [pizzasCategory],
  });

function asGroupAdmin(extra: Record<string, MockHandler> = {}) {
  return mockApi({
    [REFRESH]: () => json(sessionFor(groupAdmin)),
    [BRANDS]: () => json(page([pizzaBrand, burgerBrand])),
    [branchesOf(ids.pizza)]: () => json(page([pizzaMall])),
    [branchesOf(ids.burger)]: () => json(page([burgerAirport])),
    [LIST]: categoriesByBrand,
    ...extra,
  });
}

const tabs = () =>
  within(screen.getByRole('navigation', { name: 'Menu sections' }))
    .getAllByRole('link')
    .map((link) => link.getAttribute('href'));

describe('the menu area for a group admin', () => {
  it('lets them choose the brand, and starts with the first one', async () => {
    const mock = asGroupAdmin();
    renderApp('/admin/menu/categories');

    const picker = await screen.findByLabelText('Brand');
    expect(await screen.findByText('Pizzas')).toBeInTheDocument();

    expect(picker).toHaveValue(ids.pizza);
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Pizza Palace', 'Burger Hub']);
    expect(mock.calls.find((call) => call.key === LIST)?.url.searchParams.get('brandId')).toBe(
      ids.pizza,
    );
  });

  it('shows the menu of another brand when it is chosen, and keeps the choice in the sections', async () => {
    const user = userEvent.setup();
    asGroupAdmin();
    renderApp('/admin/menu/categories');
    await screen.findByText('Pizzas');

    await user.selectOptions(screen.getByLabelText('Brand'), ids.burger);

    expect(await screen.findByText('Burgers')).toBeInTheDocument();
    expect(screen.queryByText('Pizzas')).not.toBeInTheDocument();
    expect(tabs()).toEqual([
      `/admin/menu/items?brandId=${ids.burger}`,
      `/admin/menu/categories?brandId=${ids.burger}`,
    ]);
  });

  it('opens the brand named in the address', async () => {
    asGroupAdmin();
    renderApp(`/admin/menu/categories?brandId=${ids.burger}`);
    expect(await screen.findByText('Burgers')).toBeInTheDocument();
    expect(screen.getByLabelText('Brand')).toHaveValue(ids.burger);
  });

  it('falls back to the first brand when the address names one that does not exist', async () => {
    asGroupAdmin();
    renderApp('/admin/menu/categories?brandId=01990000-0000-7000-8000-000000000999');

    expect(await screen.findByText('Pizzas')).toBeInTheDocument();
    expect(screen.getByLabelText('Brand')).toHaveValue(ids.pizza);
  });

  it('marks a brand that is not active in the choice', async () => {
    asGroupAdmin({ [BRANDS]: () => json(page([pizzaBrand, { ...burgerBrand, isActive: false }])) });
    renderApp('/admin/menu/categories');

    const picker = await screen.findByLabelText('Brand');

    expect(
      within(picker).getByRole('option', { name: 'Burger Hub (inactive)' }),
    ).toBeInTheDocument();
  });

  it('does not ask for a brand when there is only one', async () => {
    asGroupAdmin({ [BRANDS]: () => json(page([pizzaBrand])) });
    renderApp('/admin/menu/categories');

    expect(await screen.findByText('Pizzas')).toBeInTheDocument();
    expect(screen.queryByLabelText('Brand')).not.toBeInTheDocument();
    expect(tabs()).toEqual(['/admin/menu/items', '/admin/menu/categories']);
  });

  it('says so when there is no brand yet', async () => {
    asGroupAdmin({ [BRANDS]: () => json(page([])) });
    renderApp('/admin/menu');

    expect(
      await screen.findByText('There is no brand to build a menu for yet.'),
    ).toBeInTheDocument();
  });

  it('says so when the brands cannot be loaded', async () => {
    asGroupAdmin({ [BRANDS]: () => errorResponse(500, 'INTERNAL_ERROR') });
    renderApp('/admin/menu');

    expect(await screen.findByText('Could not load the data.')).toBeInTheDocument();
  });
});

describe('the menu area for a person who belongs to a brand', () => {
  it('opens the menu of their brand, with no choice of brand', async () => {
    const mock = mockApi({
      [REFRESH]: () => json(sessionFor(fullBrandManager)),
      [BRANDS]: () => json(page([pizzaBrand])),
      [branchesOf(ids.pizza)]: () => json(page([pizzaMall])),
      [LIST]: categoriesByBrand,
    });
    renderApp('/admin/menu/categories');

    expect(await screen.findByText('Pizzas')).toBeInTheDocument();
    expect(screen.queryByLabelText('Brand')).not.toBeInTheDocument();
    expect(mock.calls.find((call) => call.key === LIST)?.url.searchParams.get('brandId')).toBe(
      ids.pizza,
    );
  });

  it('works for a person who cannot list brands at all', async () => {
    // A cashier can read the menu, but has no right to the brands or the branches.
    mockApi({
      [REFRESH]: () => json(sessionFor(cashier)),
      [LIST]: categoriesByBrand,
    });
    renderApp('/admin/menu/categories');

    expect(await screen.findByText('Pizzas')).toBeInTheDocument();
    expect(screen.getByText('You can see the menu but you cannot change it.')).toBeInTheDocument();
  });

  it('keeps the page from a person who has no right to the menu', async () => {
    mockApi({ [REFRESH]: () => json(sessionFor({ ...cashier, permissions: [] })) });
    renderApp('/admin/menu');

    expect(
      await screen.findByText('You do not have permission to open this page.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Pizzas')).not.toBeInTheDocument());
  });
});
