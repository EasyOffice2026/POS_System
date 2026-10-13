import { closedWeek, type OpeningHours } from '@pos/shared';
import { fireEvent, screen, within } from '@testing-library/react';
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
  branchOverride,
  drinksCategory,
  itemDetail,
  itemIds,
  pizzasCategory,
  sidesCategory,
} from '../../test/menu-fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const REFRESH = 'POST /api/v1/auth/refresh';
const BRANDS = 'GET /api/v1/brands';
const BRANCHES = `GET /api/v1/brands/${ids.pizza}/branches`;
const CATEGORIES = 'GET /api/v1/menu/categories';
const ITEM = `GET /api/v1/menu/items/${itemIds.margherita}`;
const OVERRIDES = `GET /api/v1/menu/items/${itemIds.margherita}/branch-overrides`;
const PUT = `PUT /api/v1/menu/items/${itemIds.margherita}/branch-override`;

const PAGE = `/admin/menu/items/${itemIds.margherita}?tab=pricing`;
const mall = 'Pizza Palace - Mall Branch';
const downtown = 'Pizza Palace - Downtown Branch';

type Day = OpeningHours['sunday'];
const lunch: Day = { kind: 'ranges', ranges: [{ open: '11:00', close: '16:00' }] };
const week = (days: Partial<OpeningHours>): OpeningHours => ({ ...closedWeek(), ...days });

function api(
  overrides: unknown[] = [],
  extra: Record<string, MockHandler> = {},
  user = fullBrandManager,
) {
  return mockApi({
    [REFRESH]: () => json(sessionFor(user)),
    [BRANDS]: () => json(page([pizzaBrand])),
    [BRANCHES]: () => json(page([pizzaMall, pizzaDowntown])),
    [CATEGORIES]: () => json({ data: [pizzasCategory, sidesCategory, drinksCategory] }),
    [ITEM]: () => json(itemDetail()),
    [OVERRIDES]: () => json({ data: overrides }),
    ...extra,
  });
}

const bodyOf = (mock: ReturnType<typeof mockApi>) =>
  mock.calls.find((call) => call.key === PUT)?.body;

const cardOf = async (name: string) => (await screen.findByText(name)).closest('li') as HTMLElement;

describe('the prices of an item at each branch', () => {
  it('opens from its tab, and shows every branch with the brand price when it changes nothing', async () => {
    const user = userEvent.setup();
    api();
    renderApp(`/admin/menu/items/${itemIds.margherita}`);

    await user.click(await screen.findByRole('link', { name: 'Branch prices' }));

    const card = await cardOf(mall);
    expect(screen.getByRole('link', { name: 'Branch prices' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(card).getByText('25.000')).toBeInTheDocument();
    expect(within(card).getByText('brand price')).toBeInTheDocument();
    expect(within(card).getByText('Available')).toBeInTheDocument();
    expect(within(card).getByText('Always')).toBeInTheDocument();
    expect(within(await cardOf(downtown)).getByText('25.000')).toBeInTheDocument();
  });

  it('shows what a branch changes: its price, that it is switched off, and its times', async () => {
    api([
      branchOverride({ price: '27.000' }),
      branchOverride({
        branchId: ids.pizzaDowntown,
        isAvailable: false,
        schedule: week({ sunday: lunch, monday: lunch }),
      }),
    ]);
    renderApp(PAGE);

    const mallCard = await cardOf(mall);
    const downtownCard = await cardOf(downtown);

    expect(within(mallCard).getByText('27.000')).toBeInTheDocument();
    expect(within(mallCard).queryByText('brand price')).not.toBeInTheDocument();
    expect(within(downtownCard).getByText('Switched off')).toBeInTheDocument();
    expect(within(downtownCard).getByText('Sun–Mon: 11:00–16:00')).toBeInTheDocument();
  });

  it('marks a branch that is not active', async () => {
    api([], {
      [BRANCHES]: () => json(page([pizzaMall, { ...pizzaDowntown, isActive: false }])),
    });
    renderApp(PAGE);

    expect(within(await cardOf(downtown)).getByText('Inactive')).toBeInTheDocument();
    expect(within(await cardOf(mall)).queryByText('Inactive')).not.toBeInTheDocument();
  });

  it('says so when the brand has no branches, and when the prices cannot be loaded', async () => {
    api([], { [BRANCHES]: () => json(page([])) });
    renderApp(PAGE);
    expect(await screen.findByText('There are no branches to show.')).toBeInTheDocument();
  });

  it('says so when the prices cannot be loaded', async () => {
    api([], { [OVERRIDES]: () => errorResponse(500, 'INTERNAL_ERROR') });
    renderApp(PAGE);

    expect(await screen.findByText('Could not load the data.')).toBeInTheDocument();
  });

  it('shows a person who may not change the menu the branches without a way to change them', async () => {
    api([], {}, { ...brandManager });
    renderApp(PAGE);

    await cardOf(mall);

    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument();
  });

  it('shows the words of the screen in Arabic', async () => {
    await i18n.changeLanguage('ar');
    api([branchOverride({ isAvailable: false })]);
    renderApp(PAGE);

    const card = await cardOf('بيتزا بالاس - فرع المول');

    expect(within(card).getByText('موقوف')).toBeInTheDocument();
    expect(
      within(card).getByRole('button', { name: 'تعديل بيتزا بالاس - فرع المول' }),
    ).toBeInTheDocument();
  });
});

describe('changing the price of an item at a branch', () => {
  async function openMall(user: ReturnType<typeof userEvent.setup>) {
    const card = await cardOf(mall);
    await user.click(within(card).getByRole('button', { name: `Edit ${mall}` }));
    return card;
  }

  it('sets the price of the branch, and shows it', async () => {
    const user = userEvent.setup();
    const mock = api([], {
      [PUT]: ({ body }) =>
        json({ itemId: itemIds.margherita, ...(body as object), price: '27.000' }),
    });
    renderApp(PAGE);
    const card = await openMall(user);

    expect(within(card).getByLabelText('Price at this branch')).toHaveAccessibleDescription(
      'Leave empty to use the brand price (25.000).',
    );
    await user.type(within(card).getByLabelText('Price at this branch'), '27');
    await user.click(within(card).getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('status')).toHaveTextContent(`Saved for ${mall}.`);
    expect(bodyOf(mock)).toEqual({
      branchId: ids.pizzaMall,
      price: '27',
      isAvailable: true,
      schedule: null,
    });
    const after = await cardOf(mall);
    expect(within(after).getByText('27.000')).toBeInTheDocument();
    expect(within(after).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('accepts a price typed with Arabic digits', async () => {
    const user = userEvent.setup();
    const mock = api([], {
      [PUT]: ({ body }) =>
        json({ itemId: itemIds.margherita, ...(body as object), price: '27.500' }),
    });
    renderApp(PAGE);
    const card = await openMall(user);

    await user.type(within(card).getByLabelText('Price at this branch'), '٢٧٫٥');
    await user.click(within(card).getByRole('button', { name: 'Save' }));

    await screen.findByRole('status');
    expect(bodyOf(mock)).toMatchObject({ price: '27.5' });
  });

  it('switches the item off at the branch', async () => {
    const user = userEvent.setup();
    const mock = api([], {
      [PUT]: ({ body }) => json({ itemId: itemIds.margherita, ...(body as object) }),
    });
    renderApp(PAGE);
    const card = await openMall(user);

    await user.click(within(card).getByRole('checkbox', { name: 'Available at this branch' }));
    await user.click(within(card).getByRole('button', { name: 'Save' }));

    await screen.findByRole('status');
    expect(bodyOf(mock)).toMatchObject({ isAvailable: false, price: null });
    expect(within(await cardOf(mall)).getByText('Switched off')).toBeInTheDocument();
  });

  it('limits the item to certain times, a day at a time', async () => {
    const user = userEvent.setup();
    const mock = api([], {
      [PUT]: ({ body }) => json({ itemId: itemIds.margherita, ...(body as object) }),
    });
    renderApp(PAGE);
    const card = await openMall(user);

    expect(within(card).queryByLabelText('Availability on Monday')).not.toBeInTheDocument();
    await user.selectOptions(within(card).getByLabelText('When can it be sold?'), 'times');
    expect(within(card).getAllByRole('combobox', { name: /Availability on/ })).toHaveLength(7);
    await user.selectOptions(within(card).getByLabelText('Availability on Monday'), 'ranges');
    await user.selectOptions(within(card).getByLabelText('Availability on Friday'), 'closed');
    await user.click(within(card).getByRole('button', { name: 'Save' }));

    await screen.findByRole('status');
    const body = bodyOf(mock) as { schedule: OpeningHours };
    expect(body.schedule.monday).toEqual({
      kind: 'ranges',
      ranges: [{ open: '09:00', close: '17:00' }],
    });
    expect(body.schedule.friday).toEqual({ kind: 'closed' });
    expect(body.schedule.sunday).toEqual({ kind: 'all_day' });
    expect(
      within(await cardOf(mall)).getByText(
        'Sun: all day; Mon: 09:00–17:00; Tue–Thu: all day; Sat: all day',
      ),
    ).toBeInTheDocument();
  });

  it('shows the times of a branch that has some, ready to be changed', async () => {
    const user = userEvent.setup();
    api([branchOverride({ schedule: week({ sunday: lunch }) })]);
    renderApp(PAGE);
    const card = await openMall(user);

    expect(within(card).getByLabelText('When can it be sold?')).toHaveValue('times');
    expect(within(card).getByLabelText('Availability on Sunday')).toHaveValue('ranges');
    expect(within(card).getByLabelText('Sunday: available from (range 1)')).toHaveValue('11:00');
    expect(
      within(card).queryByLabelText('Monday: available from (range 1)'),
    ).not.toBeInTheDocument();
  });

  it('refuses a price that is not a price, before sending anything', async () => {
    const user = userEvent.setup();
    const mock = api();
    renderApp(PAGE);
    const card = await openMall(user);

    await user.type(within(card).getByLabelText('Price at this branch'), 'abc');
    await user.click(within(card).getByRole('button', { name: 'Save' }));

    expect(within(card).getByLabelText('Price at this branch')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(mock.count(PUT)).toBe(0);
  });

  it('shows a problem with the times on the range that has it', async () => {
    const user = userEvent.setup();
    const mock = api();
    renderApp(PAGE);
    const card = await openMall(user);

    await user.selectOptions(within(card).getByLabelText('When can it be sold?'), 'times');
    await user.selectOptions(within(card).getByLabelText('Availability on Monday'), 'ranges');
    const closes = within(card).getByLabelText('Monday: available until (range 1)');
    fireEvent.change(closes, { target: { value: '09:00' } });
    await user.click(within(card).getByRole('button', { name: 'Save' }));

    expect(
      within(card).getByText('The closing time must differ from the opening time.'),
    ).toBeInTheDocument();
    expect(mock.count(PUT)).toBe(0);
  });

  it('shows a problem the server finds on the price', async () => {
    const user = userEvent.setup();
    api([], {
      [PUT]: () =>
        errorResponse(400, 'VALIDATION_ERROR', [{ path: 'price', message: 'PRICE_INVALID' }]),
    });
    renderApp(PAGE);
    const card = await openMall(user);

    await user.type(within(card).getByLabelText('Price at this branch'), '27');
    await user.click(within(card).getByRole('button', { name: 'Save' }));

    expect(
      await within(card).findByText(/Enter a number with at most 3 decimals/),
    ).toBeInTheDocument();
  });

  it('says so when the branch is not in the brand, and when it is not allowed', async () => {
    const user = userEvent.setup();
    let answer: 'branch' | 'forbidden' = 'branch';
    api([], {
      [PUT]: () =>
        answer === 'branch'
          ? errorResponse(400, 'VALIDATION_ERROR', [
              { path: 'branchId', message: 'BRANCH_NOT_FOUND' },
            ])
          : errorResponse(403, 'FORBIDDEN'),
    });
    renderApp(PAGE);
    const card = await openMall(user);

    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'A chosen branch does not exist in this brand.',
    );

    answer = 'forbidden';
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('You are not allowed to do this.')).toBeInTheDocument();
  });

  it('closes the form without sending anything when it is cancelled', async () => {
    const user = userEvent.setup();
    const mock = api();
    renderApp(PAGE);
    const card = await openMall(user);

    await user.type(within(card).getByLabelText('Price at this branch'), '27');
    await user.click(within(card).getByRole('button', { name: 'Cancel' }));

    expect(within(card).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(mock.count(PUT)).toBe(0);
    expect(within(card).getByText('brand price')).toBeInTheDocument();
  });

  it('puts a branch back to the settings of the brand', async () => {
    const user = userEvent.setup();
    const mock = api([branchOverride({ price: '27.000', isAvailable: false })], {
      [PUT]: ({ body }) => json({ itemId: itemIds.margherita, ...(body as object) }),
    });
    renderApp(PAGE);
    const card = await openMall(user);

    await user.click(within(card).getByRole('button', { name: 'Use the brand settings' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      `${mall} now uses the brand settings.`,
    );
    expect(bodyOf(mock)).toEqual({
      branchId: ids.pizzaMall,
      price: null,
      isAvailable: true,
      schedule: null,
    });
    const after = await cardOf(mall);
    expect(within(after).getByText('25.000')).toBeInTheDocument();
    expect(within(after).getByText('brand price')).toBeInTheDocument();
    expect(within(after).getByText('Available')).toBeInTheDocument();
  });

  it('offers to put a branch back only when it has changes', async () => {
    const user = userEvent.setup();
    api();
    renderApp(PAGE);
    const card = await openMall(user);

    expect(
      within(card).queryByRole('button', { name: 'Use the brand settings' }),
    ).not.toBeInTheDocument();
  });
});
