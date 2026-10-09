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
  groupIds,
  itemDetail,
  itemIds,
  modifier,
  modifierGroup,
  modifierIds,
  pizzasCategory,
  sidesCategory,
  sizeGroup,
  toppingsGroup,
} from '../../test/menu-fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const REFRESH = 'POST /api/v1/auth/refresh';
const BRANDS = 'GET /api/v1/brands';
const BRANCHES = `GET /api/v1/brands/${ids.pizza}/branches`;
const CATEGORIES = 'GET /api/v1/menu/categories';
const ITEM = `GET /api/v1/menu/items/${itemIds.margherita}`;
const CREATE_GROUP = `POST /api/v1/menu/items/${itemIds.margherita}/modifier-groups`;
const patchGroup = (id: string) => `PATCH /api/v1/menu/modifier-groups/${id}`;
const createModifier = (groupId: string) =>
  `POST /api/v1/menu/modifier-groups/${groupId}/modifiers`;
const patchModifier = (id: string) => `PATCH /api/v1/menu/modifiers/${id}`;

const PAGE = `/admin/menu/items/${itemIds.margherita}?tab=modifiers`;

type User = ReturnType<typeof userEvent.setup>;

function api(
  groups = [sizeGroup, toppingsGroup],
  extra: Record<string, MockHandler> = {},
  user = fullBrandManager,
) {
  return mockApi({
    [REFRESH]: () => json(sessionFor(user)),
    [BRANDS]: () => json(page([pizzaBrand])),
    [BRANCHES]: () => json(page([pizzaMall])),
    [CATEGORIES]: () => json({ data: [pizzasCategory, sidesCategory, drinksCategory] }),
    [ITEM]: () => json(itemDetail({ modifierGroups: groups })),
    ...extra,
  });
}

const bodyOf = (mock: ReturnType<typeof mockApi>, key: string) =>
  mock.calls.find((call) => call.key === key)?.body;

const sectionOf = async (name: string) =>
  (await screen.findByRole('heading', { name })).closest('section') as HTMLElement;

const addGroupSection = () => sectionOf('Add a modifier group');

async function fillNames(user: User, within_: HTMLElement, en: string, ar: string) {
  await user.type(within(within_).getAllByLabelText('Name (English)').at(-1) as HTMLElement, en);
  await user.type(within(within_).getAllByLabelText('Name (Arabic)').at(-1) as HTMLElement, ar);
}

describe('the modifiers of an item', () => {
  it('opens from its tab, and shows each group with what the guest has to choose', async () => {
    const user = userEvent.setup();
    api();
    renderApp(`/admin/menu/items/${itemIds.margherita}`);

    await user.click(await screen.findByRole('link', { name: 'Modifiers' }));

    const size = await sectionOf('Size');
    const toppings = await sectionOf('Extra toppings');
    expect(within(size).getByText('Required: choose 1')).toBeInTheDocument();
    expect(within(size).getByText('الحجم')).toHaveAttribute('lang', 'ar');
    expect(within(toppings).getByText('Optional: up to 3')).toBeInTheDocument();
  });

  it('shows each modifier with its price change and its sign, and marks one that is not active', async () => {
    api();
    renderApp(PAGE);

    const size = await sectionOf('Size');
    const toppings = await sectionOf('Extra toppings');

    expect(within(size).getByText('-5.000')).toBeInTheDocument();
    expect(within(size).getByText('0.000')).toBeInTheDocument();
    expect(within(size).getByText('+6.000')).toBeInTheDocument();
    expect(within(size).getAllByText('SAR')).toHaveLength(3);
    const olives = within(toppings).getByText('Olives').closest('li') as HTMLElement;
    expect(within(olives).getByText('Inactive')).toBeInTheDocument();
  });

  it('describes a group that needs a range of choices', async () => {
    api([modifierGroup({ minSelect: 2, maxSelect: 4 })]);
    renderApp(PAGE);

    expect(await screen.findByText('Required: choose 2 to 4')).toBeInTheDocument();
  });

  it('says so when the item has no modifiers, and when a group has none', async () => {
    api([]);
    renderApp(PAGE);
    expect(await screen.findByText('This item has no modifiers yet.')).toBeInTheDocument();
  });

  it('says so when a group has no modifiers', async () => {
    api([modifierGroup({ modifiers: [] })]);
    renderApp(PAGE);

    expect(await screen.findByText('This group has no modifiers yet.')).toBeInTheDocument();
  });

  it('shows a person who may not change the menu the groups, with nothing to change them with', async () => {
    api([sizeGroup], {}, { ...brandManager });
    renderApp(PAGE);

    const size = await sectionOf('Size');

    expect(within(size).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Add a modifier group' })).not.toBeInTheDocument();
  });

  it('shows the words of the screen in Arabic', async () => {
    await i18n.changeLanguage('ar');
    api([sizeGroup]);
    renderApp(PAGE);

    const size = await sectionOf('الحجم');

    expect(within(size).getByText('إلزامي: اختر 1')).toBeInTheDocument();
    expect(within(size).getByRole('button', { name: 'تعديل المجموعة الحجم' })).toBeInTheDocument();
    expect(within(size).getByRole('button', { name: 'إيقاف صغير' })).toBeInTheDocument();
  });
});

describe('adding a group of modifiers', () => {
  const newGroup = modifierGroup({
    id: '01990000-0000-7000-8000-000000000610',
    name: { en: 'Crust', ar: 'العجينة' },
    minSelect: 1,
    maxSelect: 2,
    modifiers: [],
  });

  it('sends both names and the fewest and most choices, and shows the new group', async () => {
    const user = userEvent.setup();
    const mock = api([sizeGroup], { [CREATE_GROUP]: () => json(newGroup, 201) });
    renderApp(PAGE);
    const form = await addGroupSection();
    await fillNames(user, form, 'Crust', 'العجينة');

    await user.clear(within(form).getByLabelText('Fewest choices'));
    await user.type(within(form).getByLabelText('Fewest choices'), '1');
    await user.clear(within(form).getByLabelText('Most choices'));
    await user.type(within(form).getByLabelText('Most choices'), '2');
    await user.click(within(form).getByRole('button', { name: 'Add group' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    expect(bodyOf(mock, CREATE_GROUP)).toEqual({
      name: { en: 'Crust', ar: 'العجينة' },
      minSelect: 1,
      maxSelect: 2,
    });
    expect(await sectionOf('Crust')).toBeInTheDocument();
    expect(within(form).getAllByLabelText('Name (English)').at(-1)).toHaveValue('');
    expect(within(form).getByLabelText('Fewest choices')).toHaveValue('0');
    expect(within(form).getByLabelText('Most choices')).toHaveValue('1');
  });

  it('starts as an optional group of one choice', async () => {
    api([]);
    renderApp(PAGE);
    const form = await addGroupSection();

    expect(within(form).getByLabelText('Fewest choices')).toHaveValue('0');
    expect(within(form).getByLabelText('Most choices')).toHaveValue('1');
  });

  it('asks for both names before sending anything', async () => {
    const user = userEvent.setup();
    const mock = api([]);
    renderApp(PAGE);
    const form = await addGroupSection();

    await user.click(within(form).getByRole('button', { name: 'Add group' }));

    expect(within(form).getByLabelText('Name (English)')).toHaveAttribute('aria-invalid', 'true');
    expect(within(form).getByLabelText('Name (Arabic)')).toHaveAttribute('aria-invalid', 'true');
    expect(mock.count(CREATE_GROUP)).toBe(0);
  });

  it('refuses a fewest choices that is more than the most choices', async () => {
    const user = userEvent.setup();
    const mock = api([]);
    renderApp(PAGE);
    const form = await addGroupSection();
    await fillNames(user, form, 'Crust', 'العجينة');

    await user.clear(within(form).getByLabelText('Fewest choices'));
    await user.type(within(form).getByLabelText('Fewest choices'), '3');
    await user.click(within(form).getByRole('button', { name: 'Add group' }));

    expect(within(form).getByLabelText('Most choices')).toHaveAccessibleDescription(
      /The most choices cannot be fewer than the least choices\./,
    );
    expect(mock.count(CREATE_GROUP)).toBe(0);
  });

  it.each([
    ['Fewest choices', '21', 'Enter a whole number from 0 to 20.'],
    ['Fewest choices', 'abc', 'Enter a whole number from 0 to 20.'],
    ['Most choices', '0', 'Enter a whole number from 1 to 20.'],
    ['Most choices', '1.5', 'Enter a whole number from 1 to 20.'],
  ])('refuses %s of %s', async (label, value, message) => {
    const user = userEvent.setup();
    const mock = api([]);
    renderApp(PAGE);
    const form = await addGroupSection();
    await fillNames(user, form, 'Crust', 'العجينة');

    await user.clear(within(form).getByLabelText(label));
    await user.type(within(form).getByLabelText(label), value);
    await user.click(within(form).getByRole('button', { name: 'Add group' }));

    expect(within(form).getByLabelText(label)).toHaveAccessibleDescription(
      new RegExp(message.replaceAll('.', '\\.')),
    );
    expect(mock.count(CREATE_GROUP)).toBe(0);
  });

  it('accepts the numbers typed with Arabic digits', async () => {
    const user = userEvent.setup();
    const mock = api([], { [CREATE_GROUP]: () => json(newGroup, 201) });
    renderApp(PAGE);
    const form = await addGroupSection();
    await fillNames(user, form, 'Crust', 'العجينة');

    await user.clear(within(form).getByLabelText('Most choices'));
    await user.type(within(form).getByLabelText('Most choices'), '٣');
    expect(within(form).getByLabelText('Most choices')).toHaveValue('3');
    await user.click(within(form).getByRole('button', { name: 'Add group' }));

    await screen.findByRole('status');
    expect(bodyOf(mock, CREATE_GROUP)).toMatchObject({ maxSelect: 3 });
  });

  it('shows a problem the server finds on the field that has it', async () => {
    const user = userEvent.setup();
    api([], {
      [CREATE_GROUP]: () =>
        errorResponse(400, 'VALIDATION_ERROR', [{ path: 'name.ar', message: 'NAME_TOO_LONG' }]),
    });
    renderApp(PAGE);
    const form = await addGroupSection();
    await fillNames(user, form, 'Crust', 'العجينة');

    await user.click(within(form).getByRole('button', { name: 'Add group' }));

    expect(
      await within(form).findByText('A name can have at most 100 characters.'),
    ).toBeInTheDocument();
  });
});

describe('changing a group of modifiers', () => {
  const edit = async (user: User, name: string) => {
    const section = await sectionOf(name);
    await user.click(within(section).getByRole('button', { name: `Edit group ${name}` }));
    return section;
  };

  it('changes the names, and sends only the names', async () => {
    const user = userEvent.setup();
    const mock = api([sizeGroup], {
      [patchGroup(groupIds.size)]: () =>
        json({ ...sizeGroup, name: { en: 'Pizza size', ar: 'الحجم' } }),
    });
    renderApp(PAGE);
    const section = await edit(user, 'Size');

    const english = within(section).getAllByLabelText('Name (English)')[0] as HTMLElement;
    expect(english).toHaveValue('Size');
    await user.clear(english);
    await user.type(english, 'Pizza size');
    await user.click(within(section).getAllByRole('button', { name: 'Save' })[0] as HTMLElement);

    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    expect(bodyOf(mock, patchGroup(groupIds.size))).toEqual({
      name: { en: 'Pizza size', ar: 'الحجم' },
    });
    expect(await sectionOf('Pizza size')).toBeInTheDocument();
  });

  it('sends both numbers when one of them changed, and shows the new rule', async () => {
    const user = userEvent.setup();
    const mock = api([toppingsGroup], {
      [patchGroup(groupIds.toppings)]: () => json({ ...toppingsGroup, minSelect: 1, maxSelect: 3 }),
    });
    renderApp(PAGE);
    const section = await edit(user, 'Extra toppings');

    const fewest = within(section).getAllByLabelText('Fewest choices')[0] as HTMLElement;
    await user.clear(fewest);
    await user.type(fewest, '1');
    await user.click(within(section).getAllByRole('button', { name: 'Save' })[0] as HTMLElement);

    await screen.findByRole('status');
    expect(bodyOf(mock, patchGroup(groupIds.toppings))).toEqual({ minSelect: 1, maxSelect: 3 });
    expect(within(section).getByText('Required: choose 1 to 3')).toBeInTheDocument();
  });

  it('refuses a fewest choices above the most choices, before sending anything', async () => {
    const user = userEvent.setup();
    const mock = api([toppingsGroup]);
    renderApp(PAGE);
    const section = await edit(user, 'Extra toppings');

    const fewest = within(section).getAllByLabelText('Fewest choices')[0] as HTMLElement;
    await user.clear(fewest);
    await user.type(fewest, '5');
    await user.click(within(section).getAllByRole('button', { name: 'Save' })[0] as HTMLElement);

    expect(within(section).getAllByLabelText('Most choices')[0]).toHaveAccessibleDescription(
      /The most choices cannot be fewer than the least choices\./,
    );
    expect(mock.calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
  });

  it('closes without sending anything when nothing changed, or when it is cancelled', async () => {
    const user = userEvent.setup();
    const mock = api([sizeGroup]);
    renderApp(PAGE);
    const section = await edit(user, 'Size');

    await user.click(within(section).getAllByRole('button', { name: 'Save' })[0] as HTMLElement);
    expect(within(section).queryByLabelText('Fewest choices')).not.toBeInTheDocument();

    await user.click(within(section).getByRole('button', { name: 'Edit group Size' }));
    await user.click(within(section).getByRole('button', { name: 'Cancel' }));

    expect(within(section).queryByLabelText('Fewest choices')).not.toBeInTheDocument();
    expect(mock.calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
  });

  it('deactivates a group and activates it again', async () => {
    const user = userEvent.setup();
    let isActive = true;
    const mock = api([sizeGroup], {
      [patchGroup(groupIds.size)]: () => {
        isActive = !isActive;
        return json({ ...sizeGroup, isActive });
      },
    });
    renderApp(PAGE);
    const section = await sectionOf('Size');

    await user.click(within(section).getByRole('button', { name: 'Deactivate group Size' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    expect(bodyOf(mock, patchGroup(groupIds.size))).toEqual({ isActive: false });
    expect(within(section).getByText('Inactive')).toBeInTheDocument();

    await user.click(within(section).getByRole('button', { name: 'Activate group Size' }));

    await screen.findByRole('button', { name: 'Deactivate group Size' });
    expect(within(section).queryByText('Inactive')).not.toBeInTheDocument();
  });

  it('says so when a group could not be changed', async () => {
    const user = userEvent.setup();
    api([sizeGroup], { [patchGroup(groupIds.size)]: () => errorResponse(404, 'NOT_FOUND') });
    renderApp(PAGE);
    const section = await sectionOf('Size');

    await user.click(within(section).getByRole('button', { name: 'Deactivate group Size' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This item does not exist, or you cannot see it.',
    );
  });
});

describe('the modifiers of a group', () => {
  const extra = modifier({
    id: '01990000-0000-7000-8000-000000000720',
    name: { en: 'Stuffed crust', ar: 'حافة محشوة' },
    priceDelta: '4.000',
  });

  it('adds a modifier with both names and a price change, and shows it in the group', async () => {
    const user = userEvent.setup();
    const mock = api([sizeGroup, toppingsGroup], {
      [createModifier(groupIds.toppings)]: () =>
        json({ ...extra, groupId: groupIds.toppings }, 201),
    });
    renderApp(PAGE);
    const section = await sectionOf('Extra toppings');

    await user.type(
      within(section).getAllByLabelText('Name (English)').at(-1) as HTMLElement,
      'Stuffed crust',
    );
    await user.type(
      within(section).getAllByLabelText('Name (Arabic)').at(-1) as HTMLElement,
      'حافة محشوة',
    );
    await user.type(within(section).getAllByLabelText('Price change').at(-1) as HTMLElement, '4');
    await user.click(within(section).getByRole('button', { name: 'Add modifier' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    expect(bodyOf(mock, createModifier(groupIds.toppings))).toEqual({
      name: { en: 'Stuffed crust', ar: 'حافة محشوة' },
      priceDelta: '4',
    });
    expect(within(section).getByText('Stuffed crust')).toBeInTheDocument();
    expect(within(section).getByText('+4.000')).toBeInTheDocument();
    expect(within(section).getAllByLabelText('Name (English)').at(-1)).toHaveValue('');
    expect(within(section).getAllByLabelText('Price change').at(-1)).toHaveValue('');
  });

  it('leaves the price change out when it is empty, and takes a minus sign for a discount', async () => {
    const user = userEvent.setup();
    const mock = api([toppingsGroup], {
      [createModifier(groupIds.toppings)]: ({ body }) =>
        json(
          {
            ...extra,
            groupId: groupIds.toppings,
            name: (body as { name: typeof extra.name }).name,
            priceDelta: '0.000',
          },
          201,
        ),
    });
    renderApp(PAGE);
    const section = await sectionOf('Extra toppings');

    await user.type(
      within(section).getAllByLabelText('Name (English)').at(-1) as HTMLElement,
      'No sauce',
    );
    await user.type(
      within(section).getAllByLabelText('Name (Arabic)').at(-1) as HTMLElement,
      'بدون صلصة',
    );
    await user.click(within(section).getByRole('button', { name: 'Add modifier' }));
    await screen.findByRole('status');

    expect(bodyOf(mock, createModifier(groupIds.toppings))).toEqual({
      name: { en: 'No sauce', ar: 'بدون صلصة' },
    });
  });

  it('refuses a price change that is not a number, and asks for both names', async () => {
    const user = userEvent.setup();
    const mock = api([toppingsGroup]);
    renderApp(PAGE);
    const section = await sectionOf('Extra toppings');

    await user.type(within(section).getAllByLabelText('Price change').at(-1) as HTMLElement, 'abc');
    await user.click(within(section).getByRole('button', { name: 'Add modifier' }));

    expect(within(section).getAllByLabelText('Price change').at(-1)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(within(section).getAllByLabelText('Name (English)').at(-1)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(
      mock.calls.filter(
        (call) => call.method === 'POST' && call.url.pathname.startsWith('/api/v1/menu'),
      ),
    ).toHaveLength(0);
  });

  it('says so when the group has all the modifiers it can have', async () => {
    const user = userEvent.setup();
    api([toppingsGroup], {
      [createModifier(groupIds.toppings)]: () => errorResponse(409, 'MODIFIER_LIMIT'),
    });
    renderApp(PAGE);
    const section = await sectionOf('Extra toppings');

    await user.type(
      within(section).getAllByLabelText('Name (English)').at(-1) as HTMLElement,
      'One more',
    );
    await user.type(
      within(section).getAllByLabelText('Name (Arabic)').at(-1) as HTMLElement,
      'واحد آخر',
    );
    await user.click(within(section).getByRole('button', { name: 'Add modifier' }));

    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'A group can have at most 50 modifiers.',
    );
  });

  it('changes the price of a modifier, and sends only the price', async () => {
    const user = userEvent.setup();
    const mock = api([sizeGroup], {
      [patchModifier(modifierIds.large)]: () =>
        json(
          modifier({
            id: modifierIds.large,
            name: { en: 'Large', ar: 'كبير' },
            priceDelta: '7.000',
          }),
        ),
    });
    renderApp(PAGE);
    const section = await sectionOf('Size');

    await user.click(within(section).getByRole('button', { name: 'Edit Large' }));
    const price = within(section).getAllByLabelText('Price change')[0] as HTMLElement;
    expect(price).toHaveValue('6.000');
    await user.clear(price);
    await user.type(price, '7');
    await user.click(within(section).getAllByRole('button', { name: 'Save' })[0] as HTMLElement);

    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    expect(bodyOf(mock, patchModifier(modifierIds.large))).toEqual({ priceDelta: '7' });
    expect(within(section).getByText('+7.000')).toBeInTheDocument();
  });

  it('treats 6 and 6.000 as the same price, and sends nothing', async () => {
    const user = userEvent.setup();
    const mock = api([sizeGroup]);
    renderApp(PAGE);
    const section = await sectionOf('Size');

    await user.click(within(section).getByRole('button', { name: 'Edit Large' }));
    const price = within(section).getAllByLabelText('Price change')[0] as HTMLElement;
    await user.clear(price);
    await user.type(price, '6');
    await user.click(within(section).getAllByRole('button', { name: 'Save' })[0] as HTMLElement);

    expect(within(section).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(mock.calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
  });

  it('changes the names of a modifier', async () => {
    const user = userEvent.setup();
    const mock = api([sizeGroup], {
      [patchModifier(modifierIds.small)]: () =>
        json(modifier({ name: { en: 'Mini', ar: 'صغير' } })),
    });
    renderApp(PAGE);
    const section = await sectionOf('Size');

    await user.click(within(section).getByRole('button', { name: 'Edit Small' }));
    const english = within(section).getAllByLabelText('Name (English)')[0] as HTMLElement;
    await user.clear(english);
    await user.type(english, 'Mini');
    await user.click(within(section).getAllByRole('button', { name: 'Save' })[0] as HTMLElement);

    await screen.findByRole('status');
    expect(bodyOf(mock, patchModifier(modifierIds.small))).toEqual({
      name: { en: 'Mini', ar: 'صغير' },
    });
    expect(within(section).getByText('Mini')).toBeInTheDocument();
  });

  it('deactivates a modifier and activates it again', async () => {
    const user = userEvent.setup();
    let isActive = true;
    const mock = api([sizeGroup], {
      [patchModifier(modifierIds.medium)]: () => {
        isActive = !isActive;
        return json(
          modifier({
            id: modifierIds.medium,
            name: { en: 'Medium', ar: 'وسط' },
            priceDelta: '0.000',
            isActive,
          }),
        );
      },
    });
    renderApp(PAGE);
    const section = await sectionOf('Size');
    const row = () => within(section).getByText('Medium').closest('li') as HTMLElement;

    await user.click(within(row()).getByRole('button', { name: 'Deactivate Medium' }));

    await within(row()).findByText('Inactive');
    expect(bodyOf(mock, patchModifier(modifierIds.medium))).toEqual({ isActive: false });

    await user.click(within(row()).getByRole('button', { name: 'Activate Medium' }));

    await within(row()).findByRole('button', { name: 'Deactivate Medium' });
    expect(within(row()).queryByText('Inactive')).not.toBeInTheDocument();
  });
});
