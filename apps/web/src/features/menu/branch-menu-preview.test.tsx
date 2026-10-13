import { closedWeek, type OpeningHours } from '@pos/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  burgerBrand,
  fullBrandManager,
  groupAdmin,
  ids,
  page,
  pizzaBrand,
  pizzaDowntown,
  pizzaMall,
  sessionFor,
} from '../../test/fixtures';
import { branchMenu, categoryIds, itemIds } from '../../test/menu-fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const REFRESH = 'POST /api/v1/auth/refresh';
const BRANDS = 'GET /api/v1/brands';
const BRANCHES = `GET /api/v1/brands/${ids.pizza}/branches`;
const MENU = 'GET /api/v1/menu';

type Day = OpeningHours['sunday'];
const lunch: Day = { kind: 'ranges', ranges: [{ open: '11:00', close: '16:00' }] };

afterEach(() => {
  vi.useRealTimers();
});

function api(menu: MockHandler = () => json(branchMenu())) {
  return mockApi({
    [REFRESH]: () => json(sessionFor(fullBrandManager)),
    [BRANDS]: () => json(page([pizzaBrand])),
    [BRANCHES]: () => json(page([pizzaMall, pizzaDowntown])),
    [MENU]: menu,
  });
}

// The menu with a salad that is for lunch, Sunday to Thursday.
const withLunchItem = () => {
  const menu = branchMenu();
  const [pizzas] = menu.categories;
  if (!pizzas) throw new Error('The fixture has a category.');
  pizzas.items.push({
    id: '01990000-0000-7000-8000-000000000530',
    name: { en: 'Caesar Salad', ar: 'سلطة سيزر' },
    description: null,
    price: '14.000',
    imageUrl: null,
    schedule: {
      ...closedWeek(),
      sunday: lunch,
      monday: lunch,
      tuesday: lunch,
      wednesday: lunch,
      thursday: lunch,
    },
    modifierGroups: [],
  });
  return menu;
};

describe('the branch menu preview', () => {
  it('shows the menu of the first branch as its terminal loads it', async () => {
    const mock = api();
    renderApp('/admin/menu/preview');

    expect(await screen.findByRole('heading', { name: 'Pizzas' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Drinks' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Branch menu' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByLabelText('Branch')).toHaveValue(ids.pizzaMall);
    expect(mock.calls.find((call) => call.key === MENU)?.url.searchParams.get('branchId')).toBe(
      ids.pizzaMall,
    );
  });

  it('shows each item with its price at the branch, its names, its description and its modifiers', async () => {
    api();
    renderApp('/admin/menu/preview');

    const item = (await screen.findByText('Margherita', { selector: 'p' })).closest(
      'li',
    ) as HTMLElement;

    expect(within(item).getByText('مارجريتا')).toHaveAttribute('lang', 'ar');
    expect(within(item).getByText('27.000')).toBeInTheDocument();
    expect(within(item).getByText('Tomato and basil')).toBeInTheDocument();
    expect(within(item).getByText('Size')).toBeInTheDocument();
    expect(within(item).getByText(/Required: choose 1/)).toBeInTheDocument();
    expect(within(item).getByText('-5.000')).toBeInTheDocument();
    expect(within(item).getByText('+6.000')).toBeInTheDocument();
  });

  it('shows the combos with the names of the items that fill them and their extra charges', async () => {
    api();
    renderApp('/admin/menu/preview');

    const combos = (await screen.findByRole('heading', { name: 'Combos' })).closest(
      'section',
    ) as HTMLElement;

    expect(within(combos).getByText('Pizza meal')).toBeInTheDocument();
    expect(within(combos).getByText('39.000')).toBeInTheDocument();
    const pizza = within(combos)
      .getByText('Pizza', { selector: 'p' })
      .closest('div') as HTMLElement;
    expect(within(pizza).getByText('Margherita')).toBeInTheDocument();
    expect(within(pizza).getByText('+3.000')).toBeInTheDocument();
    const drink = within(combos).getByText('Drink').closest('div') as HTMLElement;
    expect(within(drink).getByText('Cola')).toBeInTheDocument();
    expect(within(drink).queryByText(/\+/)).not.toBeInTheDocument();
  });

  it('shows the time zone and the currency of the branch', async () => {
    api();
    renderApp('/admin/menu/preview');

    const line = (await screen.findByText(/Asia\/Riyadh/)).closest('p');

    expect(line).toHaveTextContent('Asia/Riyadh · KWD');
  });

  it('loads the menu of another branch when it is chosen, and keeps the choice in the address', async () => {
    const user = userEvent.setup();
    const downtownMenu = branchMenu({
      branchId: ids.pizzaDowntown,
      categories: [
        {
          id: categoryIds.drinks,
          name: { en: 'Drinks', ar: 'المشروبات' },
          items: [
            {
              id: itemIds.cola,
              name: { en: 'Cola', ar: 'كولا' },
              description: null,
              price: '6.000',
              imageUrl: null,
              schedule: null,
              modifierGroups: [],
            },
          ],
        },
      ],
      combos: [],
    });
    const mock = api(({ url }) =>
      json(url.searchParams.get('branchId') === ids.pizzaDowntown ? downtownMenu : branchMenu()),
    );
    renderApp('/admin/menu/preview');
    await screen.findByRole('heading', { name: 'Pizzas' });

    await user.selectOptions(screen.getByLabelText('Branch'), ids.pizzaDowntown);

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Pizzas' })).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('6.000')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Combos' })).not.toBeInTheDocument();
    expect(
      mock.calls
        .filter((call) => call.key === MENU)
        .at(-1)
        ?.url.searchParams.get('branchId'),
    ).toBe(ids.pizzaDowntown);
  });

  it('opens the branch named in the address', async () => {
    api(({ url }) =>
      json(branchMenu({ branchId: url.searchParams.get('branchId') ?? ids.pizzaMall })),
    );
    renderApp(`/admin/menu/preview?branchId=${ids.pizzaDowntown}`);

    expect(await screen.findByLabelText('Branch')).toHaveValue(ids.pizzaDowntown);
  });

  it('marks a branch that is not active in the choice', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(fullBrandManager)),
      [BRANDS]: () => json(page([pizzaBrand])),
      [BRANCHES]: () => json(page([pizzaMall, { ...pizzaDowntown, isActive: false }])),
      [MENU]: () => json(branchMenu()),
    });
    renderApp('/admin/menu/preview');

    const picker = await screen.findByLabelText('Branch');

    expect(
      within(picker).getByRole('option', { name: 'Pizza Palace - Downtown Branch (inactive)' }),
    ).toBeInTheDocument();
  });

  it('says so when nothing can be sold at the branch', async () => {
    api(() => json(branchMenu({ categories: [], combos: [] })));
    renderApp('/admin/menu/preview');

    expect(await screen.findByText('Nothing can be sold at this branch yet.')).toBeInTheDocument();
  });

  it('says so when the menu cannot be loaded', async () => {
    api(() => errorResponse(500, 'INTERNAL_ERROR'));
    renderApp('/admin/menu/preview');

    expect(await screen.findByText('Could not load the data.')).toBeInTheDocument();
  });

  it('says so when the brand has no branches', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(fullBrandManager)),
      [BRANDS]: () => json(page([pizzaBrand])),
      [BRANCHES]: () => json(page([])),
    });
    renderApp('/admin/menu/preview');

    expect(
      await screen.findByText('There are no branches to show a menu for.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Branch')).not.toBeInTheDocument();
  });

  it('shows the words of the screen in Arabic', async () => {
    await i18n.changeLanguage('ar');
    api();
    renderApp('/admin/menu/preview');

    expect(await screen.findByRole('heading', { name: 'البيتزا' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'الوجبات المركبة' })).toBeInTheDocument();
    expect(screen.getAllByText('د.ك').length).toBeGreaterThan(0);
  });

  it('asks the group admin for the branches of the brand that is chosen', async () => {
    const user = userEvent.setup();
    mockApi({
      [REFRESH]: () => json(sessionFor(groupAdmin)),
      [BRANDS]: () => json(page([pizzaBrand, burgerBrand])),
      [BRANCHES]: () => json(page([pizzaMall])),
      [`GET /api/v1/brands/${ids.burger}/branches`]: () => json(page([])),
      [MENU]: () => json(branchMenu()),
    });
    renderApp('/admin/menu/preview');
    await screen.findByRole('heading', { name: 'Pizzas' });

    await user.selectOptions(screen.getByLabelText('Brand'), ids.burger);

    expect(
      await screen.findByText('There are no branches to show a menu for.'),
    ).toBeInTheDocument();
  });
});

describe('the items that are sold at certain times', () => {
  it('shows the times of the item, and says it is not available when the branch is closed to it', async () => {
    // Friday in Riyadh: the salad is for lunch from Sunday to Thursday.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T12:00:00+03:00'));
    api(() => json(withLunchItem()));
    renderApp('/admin/menu/preview');

    const salad = (await screen.findByText('Caesar Salad')).closest('li') as HTMLElement;

    expect(within(salad).getByText('Sun–Thu: 11:00–16:00')).toBeInTheDocument();
    expect(within(salad).getByText('Not available right now')).toBeInTheDocument();
  });

  it('does not say it when the item can be sold at this moment on the clock of the branch', async () => {
    // Wednesday noon in Riyadh is 09:00 UTC. The branch clock is the one that counts.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T09:00:00Z'));
    api(() => json(withLunchItem()));
    renderApp('/admin/menu/preview');

    const salad = (await screen.findByText('Caesar Salad')).closest('li') as HTMLElement;

    expect(within(salad).getByText('Sun–Thu: 11:00–16:00')).toBeInTheDocument();
    expect(within(salad).queryByText('Not available right now')).not.toBeInTheDocument();
  });

  it('says nothing about times for an item that is sold at all times', async () => {
    api();
    renderApp('/admin/menu/preview');

    const item = (await screen.findByText('Cola', { selector: 'p' })).closest('li') as HTMLElement;

    expect(within(item).queryByText('Not available right now')).not.toBeInTheDocument();
    expect(within(item).queryByText(/Every day/)).not.toBeInTheDocument();
  });
});
