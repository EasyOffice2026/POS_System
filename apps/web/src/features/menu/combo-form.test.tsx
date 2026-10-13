import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  cola,
  combo,
  comboIds,
  drinksCategory,
  itemIds,
  margherita,
  pepperoni,
  pizzaMeal,
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
const CREATE = 'POST /api/v1/menu/combos';
const one = (id: string) => `GET /api/v1/menu/combos/${id}`;
const patch = (id: string) => `PATCH /api/v1/menu/combos/${id}`;

const items = [margherita, pepperoni, cola];
const categories = [pizzasCategory, sidesCategory, drinksCategory];
const created = combo({ id: '01990000-0000-7000-8000-000000000820' });

type User = ReturnType<typeof userEvent.setup>;

function api(extra: Record<string, MockHandler> = {}, user = fullBrandManager, brandItems = items) {
  return mockApi({
    [REFRESH]: () => json(sessionFor(user)),
    [BRANDS]: () => json(page([pizzaBrand])),
    [BRANCHES]: () => json(page([pizzaMall])),
    [CATEGORIES]: () => json({ data: categories }),
    [ITEMS]: () => json(page(brandItems)),
    [CREATE]: () => json(created, 201),
    [one(created.id)]: () => json(created),
    [one(comboIds.pizzaMeal)]: () => json(pizzaMeal),
    ...extra,
  });
}

const bodyOf = (mock: ReturnType<typeof mockApi>, key: string) =>
  mock.calls.find((call) => call.key === key)?.body;

const NEW = `/admin/menu/combos/new?brandId=${ids.pizza}`;
const slot = (n: number) => screen.getByRole('group', { name: `Choice ${n}` });
const save = () => screen.getByRole('button', { name: 'Save' });

async function fillCombo(user: User) {
  await user.type(
    await screen.findByLabelText('Name (English)', { selector: '#combo-name-en' }),
    'Burger meal',
  );
  await user.type(
    screen.getByLabelText('Name (Arabic)', { selector: '#combo-name-ar' }),
    'وجبة برجر',
  );
  await user.type(screen.getByLabelText('Combo price'), '29');
  const first = slot(1);
  await user.type(within(first).getByLabelText('Name (English)'), 'Pizza');
  await user.type(within(first).getByLabelText('Name (Arabic)'), 'بيتزا');
  await user.selectOptions(within(first).getByLabelText('Choice 1, item 1'), itemIds.margherita);
}

describe('creating a combo', () => {
  it('sends the names, the price and the choices with the items that can fill them', async () => {
    const user = userEvent.setup();
    const mock = api();
    renderApp(NEW);
    await fillCombo(user);

    await user.click(within(slot(1)).getByRole('button', { name: 'Add an item to choice 1' }));
    await user.selectOptions(within(slot(1)).getByLabelText('Choice 1, item 2'), itemIds.pepperoni);
    await user.type(within(slot(1)).getByLabelText('Choice 1, item 2: extra charge'), '3');
    await user.click(save());

    expect(await screen.findByRole('heading', { name: 'Pizza meal' })).toBeInTheDocument();
    expect(bodyOf(mock, CREATE)).toEqual({
      brandId: ids.pizza,
      name: { en: 'Burger meal', ar: 'وجبة برجر' },
      price: '29',
      slots: [
        {
          name: { en: 'Pizza', ar: 'بيتزا' },
          options: [
            { itemId: itemIds.margherita, priceDelta: '0.000' },
            { itemId: itemIds.pepperoni, priceDelta: '3' },
          ],
        },
      ],
      isActive: true,
    });
    expect(screen.getByRole('status')).toHaveTextContent('Combo created.');
  });

  it('starts with one choice that has one place for an item', async () => {
    api();
    renderApp(NEW);

    await screen.findByLabelText('Combo price');

    expect(screen.getAllByRole('group', { name: /^Choice \d+$/ })).toHaveLength(1);
    expect(within(slot(1)).getByLabelText('Choice 1, item 1')).toHaveValue('');
    expect(
      within(slot(1)).queryByRole('button', { name: /^Remove choice/ }),
    ).not.toBeInTheDocument();
  });

  it('adds a choice and removes it again, and always keeps one', async () => {
    const user = userEvent.setup();
    api();
    renderApp(NEW);
    await screen.findByLabelText('Combo price');

    await user.click(screen.getByRole('button', { name: 'Add a choice' }));

    expect(screen.getAllByRole('group', { name: /^Choice \d+$/ })).toHaveLength(2);
    await user.click(within(slot(2)).getByRole('button', { name: 'Remove choice 2' }));
    expect(screen.getAllByRole('group', { name: /^Choice \d+$/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Remove choice/ })).not.toBeInTheDocument();
  });

  it('removes an item from a choice', async () => {
    const user = userEvent.setup();
    api();
    renderApp(NEW);
    await screen.findByLabelText('Combo price');
    await user.click(within(slot(1)).getByRole('button', { name: 'Add an item to choice 1' }));

    await user.click(within(slot(1)).getByRole('button', { name: 'Remove item 2 of choice 1' }));

    expect(within(slot(1)).queryByLabelText('Choice 1, item 2')).not.toBeInTheDocument();
  });

  it('offers the active items by category, and not an item already chosen in the same choice', async () => {
    const user = userEvent.setup();
    api({}, fullBrandManager, [margherita, pepperoni, { ...cola, isActive: false }]);
    renderApp(NEW);
    await screen.findByLabelText('Combo price');
    await user.click(within(slot(1)).getByRole('button', { name: 'Add an item to choice 1' }));

    await user.selectOptions(
      within(slot(1)).getByLabelText('Choice 1, item 1'),
      itemIds.margherita,
    );

    const second = within(slot(1)).getByLabelText('Choice 1, item 2');
    expect(
      within(second)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Choose an item', 'Pepperoni']);
    expect(within(second).getByRole('group', { name: 'Pizzas' })).toBeInTheDocument();
    expect(within(second).queryByRole('option', { name: /Cola/ })).not.toBeInTheDocument();
  });

  it('asks for everything that is missing before sending anything', async () => {
    const user = userEvent.setup();
    const mock = api();
    renderApp(NEW);
    await screen.findByLabelText('Combo price');

    await user.click(save());

    expect(screen.getByLabelText('Name (English)', { selector: '#combo-name-en' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('Combo price')).toHaveAttribute('aria-invalid', 'true');
    expect(within(slot(1)).getByLabelText('Name (English)')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(within(slot(1)).getByLabelText('Choice 1, item 1')).toHaveAccessibleDescription(
      'Choose an item.',
    );
    expect(mock.count(CREATE)).toBe(0);
  });

  it('says so when a choice has no item at all', async () => {
    const user = userEvent.setup();
    const mock = api();
    renderApp(NEW);
    await fillCombo(user);

    await user.click(within(slot(1)).getByRole('button', { name: 'Remove item 1 of choice 1' }));
    await user.click(save());

    expect(screen.getByText('Add at least one item to this choice.')).toBeInTheDocument();
    expect(mock.count(CREATE)).toBe(0);
  });

  it('refuses an extra charge that is not a number', async () => {
    const user = userEvent.setup();
    const mock = api();
    renderApp(NEW);
    await fillCombo(user);

    await user.type(within(slot(1)).getByLabelText('Choice 1, item 1: extra charge'), 'abc');
    await user.click(save());

    expect(
      within(slot(1)).getByLabelText('Choice 1, item 1: extra charge'),
    ).toHaveAccessibleDescription(/Enter a number with at most 3 decimals/);
    expect(mock.count(CREATE)).toBe(0);
  });

  it('takes a minus sign for an extra charge, as a discount', async () => {
    const user = userEvent.setup();
    const mock = api();
    renderApp(NEW);
    await fillCombo(user);

    await user.type(within(slot(1)).getByLabelText('Choice 1, item 1: extra charge'), '-2');
    await user.click(save());

    await screen.findByRole('status');
    expect(bodyOf(mock, CREATE)).toMatchObject({
      slots: [{ options: [{ itemId: itemIds.margherita, priceDelta: '-2' }] }],
    });
  });

  it('shows a problem the server finds on the item that has it', async () => {
    const user = userEvent.setup();
    api({
      [CREATE]: () =>
        errorResponse(400, 'VALIDATION_ERROR', [
          { path: 'slots.0.options.0.itemId', message: 'ITEM_NOT_FOUND' },
        ]),
    });
    renderApp(NEW);
    await fillCombo(user);

    await user.click(save());

    expect(within(slot(1)).getByLabelText('Choice 1, item 1')).toHaveAccessibleDescription(
      'This item does not exist, or you cannot see it.',
    );
  });

  it('can start inactive, to set it up before it is sold', async () => {
    const user = userEvent.setup();
    const mock = api();
    renderApp(NEW);
    await fillCombo(user);

    await user.click(screen.getByRole('checkbox', { name: 'Active' }));
    await user.click(save());

    await screen.findByRole('status');
    expect(bodyOf(mock, CREATE)).toMatchObject({ isActive: false });
  });

  it('sends a person to the items first when the brand has none', async () => {
    api({}, fullBrandManager, []);
    renderApp(NEW);

    expect(
      await screen.findByText(/Add some items first: a combo is made of items\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to items' })).toHaveAttribute(
      'href',
      `/admin/menu/items?brandId=${ids.pizza}`,
    );
    expect(screen.queryByLabelText('Combo price')).not.toBeInTheDocument();
  });

  it('is not offered to a person who may not change the menu', async () => {
    api({}, { ...brandManager });
    renderApp(NEW);

    expect(
      await screen.findByText('You do not have permission to open this page.'),
    ).toBeInTheDocument();
  });

  it('goes back to the list of combos', async () => {
    api();
    renderApp(NEW);

    expect(await screen.findByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      `/admin/menu/combos?brandId=${ids.pizza}`,
    );
  });
});

describe('changing a combo', () => {
  const open = async () => {
    renderApp(`/admin/menu/combos/${comboIds.pizzaMeal}`);
    await screen.findByRole('heading', { name: 'Pizza meal' });
    await screen.findByLabelText('Combo price');
  };

  it('fills the form with the combo, its choices and its items', async () => {
    api();
    await open();

    expect(screen.getByLabelText('Name (English)', { selector: '#combo-name-en' })).toHaveValue(
      'Pizza meal',
    );
    expect(screen.getByLabelText('Name (Arabic)', { selector: '#combo-name-ar' })).toHaveValue(
      'وجبة بيتزا',
    );
    expect(screen.getByLabelText('Combo price')).toHaveValue('39.000');
    expect(within(slot(1)).getByLabelText('Name (English)')).toHaveValue('Pizza');
    expect(within(slot(1)).getByLabelText('Choice 1, item 1')).toHaveValue(itemIds.margherita);
    expect(within(slot(1)).getByLabelText('Choice 1, item 2')).toHaveValue(itemIds.pepperoni);
    expect(within(slot(1)).getByLabelText('Choice 1, item 2: extra charge')).toHaveValue('3.000');
    expect(within(slot(2)).getByLabelText('Choice 2, item 1')).toHaveValue(itemIds.cola);
    expect(screen.getByRole('checkbox', { name: 'Active' })).toBeChecked();
  });

  it('sends only the price when only the price changed', async () => {
    const user = userEvent.setup();
    const mock = api({ [patch(comboIds.pizzaMeal)]: () => json(combo({ price: '35.000' })) });
    await open();

    await user.clear(screen.getByLabelText('Combo price'));
    await user.type(screen.getByLabelText('Combo price'), '35');
    await user.click(save());

    expect(await screen.findByRole('status')).toHaveTextContent('Changes saved.');
    expect(bodyOf(mock, patch(comboIds.pizzaMeal))).toEqual({ price: '35' });
  });

  it('sends all the choices when one of them changed, and nothing else', async () => {
    const user = userEvent.setup();
    const mock = api({ [patch(comboIds.pizzaMeal)]: () => json(pizzaMeal) });
    await open();

    await user.selectOptions(
      within(slot(2)).getByLabelText('Choice 2, item 1'),
      itemIds.margherita,
    );
    await user.click(save());

    await screen.findByRole('status');
    expect(bodyOf(mock, patch(comboIds.pizzaMeal))).toEqual({
      slots: [
        {
          name: { en: 'Pizza', ar: 'بيتزا' },
          options: [
            { itemId: itemIds.margherita, priceDelta: '0.000' },
            { itemId: itemIds.pepperoni, priceDelta: '3.000' },
          ],
        },
        {
          name: { en: 'Drink', ar: 'مشروب' },
          options: [{ itemId: itemIds.margherita, priceDelta: '0.000' }],
        },
      ],
    });
  });

  it('treats 3 and 3.000 as the same extra charge, and sends nothing', async () => {
    const user = userEvent.setup();
    const mock = api();
    await open();

    const extra = within(slot(1)).getByLabelText('Choice 1, item 2: extra charge');
    await user.clear(extra);
    await user.type(extra, '3');
    await user.click(save());

    expect(await screen.findByRole('status')).toHaveTextContent('Changes saved.');
    expect(mock.count(patch(comboIds.pizzaMeal))).toBe(0);
  });

  it('deactivates the combo', async () => {
    const user = userEvent.setup();
    const mock = api({ [patch(comboIds.pizzaMeal)]: () => json(combo({ isActive: false })) });
    await open();

    await user.click(screen.getByRole('checkbox', { name: 'Active' }));
    await user.click(save());

    await screen.findByRole('status');
    expect(bodyOf(mock, patch(comboIds.pizzaMeal))).toEqual({ isActive: false });
  });

  it('keeps an item that is not active where it is, marked as inactive', async () => {
    api({}, fullBrandManager, [margherita, pepperoni, { ...cola, isActive: false }]);
    await open();

    const drink = within(slot(2)).getByLabelText('Choice 2, item 1');

    expect(drink).toHaveValue(itemIds.cola);
    expect(within(drink).getByRole('option', { name: 'Cola (inactive)' })).toBeInTheDocument();
  });

  it('shows a person who may not change the menu the combo, with every field off', async () => {
    api({}, { ...brandManager });
    renderApp(`/admin/menu/combos/${comboIds.pizzaMeal}`);

    expect(
      await screen.findByText('You can see this combo but you cannot change it.'),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText('Combo price')).toBeDisabled();
    expect(within(slot(1)).getByLabelText('Choice 1, item 1')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a choice' })).not.toBeInTheDocument();
  });

  it('says so when the combo does not exist', async () => {
    api({ [one(comboIds.pizzaMeal)]: () => errorResponse(404, 'NOT_FOUND') });
    renderApp(`/admin/menu/combos/${comboIds.pizzaMeal}`);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the data.');
  });
});
