import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { describe, expect, it } from 'vitest';
import {
  brandManager,
  burgerAirport,
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
import {
  categoryIds,
  drinksCategory,
  itemDetail,
  itemIds,
  menuCategory,
  pizzasCategory,
  sidesCategory,
} from '../../test/menu-fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const REFRESH = 'POST /api/v1/auth/refresh';
const BRANDS = 'GET /api/v1/brands';
const branchesOf = (brandId: string) => `GET /api/v1/brands/${brandId}/branches`;
const CATEGORIES = 'GET /api/v1/menu/categories';
const CREATE = 'POST /api/v1/menu/items';
const one = (id: string) => `GET /api/v1/menu/items/${id}`;
const patch = (id: string) => `PATCH /api/v1/menu/items/${id}`;
const UPLOAD = 'POST /api/v1/uploads/images';

const categories = [pizzasCategory, sidesCategory, drinksCategory];
const created = itemDetail({
  id: '01990000-0000-7000-8000-000000000510',
  name: { en: 'Veggie', ar: 'خضار' },
  basePrice: '28.000',
});

const bodyOf = (mock: ReturnType<typeof mockApi>, key: string) =>
  mock.calls.find((call) => call.key === key)?.body;

type User = ReturnType<typeof userEvent.setup>;

function createApi(
  create: MockHandler = () => json(created, 201),
  extra: Record<string, MockHandler> = {},
) {
  return mockApi({
    [REFRESH]: () => json(sessionFor(fullBrandManager)),
    [BRANDS]: () => json(page([pizzaBrand])),
    [branchesOf(ids.pizza)]: () => json(page([pizzaMall, pizzaDowntown])),
    [CATEGORIES]: () => json({ data: categories }),
    [CREATE]: create,
    [one(created.id)]: () => json(created),
    ...extra,
  });
}

function editApi(item = itemDetail(), extra: Record<string, MockHandler> = {}) {
  return mockApi({
    [REFRESH]: () => json(sessionFor(fullBrandManager)),
    [BRANDS]: () => json(page([pizzaBrand])),
    [branchesOf(ids.pizza)]: () => json(page([pizzaMall, pizzaDowntown])),
    [CATEGORIES]: () => json({ data: categories }),
    [one(item.id)]: () => json(item),
    ...extra,
  });
}

async function fillBasics(user: User) {
  await user.selectOptions(await screen.findByLabelText('Category'), categoryIds.pizzas);
  await user.type(screen.getByLabelText('Name (English)'), 'Veggie');
  await user.type(screen.getByLabelText('Name (Arabic)'), 'خضار');
  await user.type(screen.getByLabelText('Price'), '28');
}

const save = () => screen.getByRole('button', { name: 'Save' });

describe('creating an item', () => {
  it('sends the brand, the category, both names and the price, then opens the new item', async () => {
    const user = userEvent.setup();
    const mock = createApi();
    renderApp(`/admin/menu/items/new?brandId=${ids.pizza}`);
    await fillBasics(user);

    await user.click(save());

    expect(await screen.findByRole('heading', { name: 'Veggie' })).toBeInTheDocument();
    expect(bodyOf(mock, CREATE)).toEqual({
      brandId: ids.pizza,
      categoryId: categoryIds.pizzas,
      name: { en: 'Veggie', ar: 'خضار' },
      basePrice: '28',
      isActive: true,
    });
    expect(screen.getByRole('status')).toHaveTextContent('Item created.');
  });

  it('shows the brand the item is made in', async () => {
    createApi();
    renderApp(`/admin/menu/items/new?brandId=${ids.pizza}`);

    expect(await screen.findByRole('heading', { name: 'New item' })).toBeInTheDocument();
    expect(await screen.findByText('Pizza Palace')).toBeInTheDocument();
  });

  it('sends a description in both languages and an image link', async () => {
    const user = userEvent.setup();
    const mock = createApi();
    renderApp(`/admin/menu/items/new?brandId=${ids.pizza}`);
    await fillBasics(user);

    await user.type(screen.getByLabelText('Description (English)'), 'Fresh vegetables');
    await user.type(screen.getByLabelText('Description (Arabic)'), 'خضار طازجة');
    await user.type(screen.getByLabelText('Image link'), 'https://cdn.example.com/veggie.png');
    await user.click(save());

    await screen.findByRole('status');
    expect(bodyOf(mock, CREATE)).toMatchObject({
      description: { en: 'Fresh vegetables', ar: 'خضار طازجة' },
      imageUrl: 'https://cdn.example.com/veggie.png',
    });
  });

  it('uploads a photo and fills the image link with its address', async () => {
    const user = userEvent.setup();
    const mock = createApi(undefined, {
      [UPLOAD]: () => json({ url: 'https://files.test/pizza/item/a.png' }, 201),
    });
    renderApp(`/admin/menu/items/new?brandId=${ids.pizza}`);
    await fillBasics(user);

    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'veggie.png', {
      type: 'image/png',
    });
    await user.upload(screen.getByLabelText('Upload a photo'), file);

    await waitFor(() =>
      expect(screen.getByLabelText('Image link')).toHaveValue(
        'https://files.test/pizza/item/a.png',
      ),
    );
    const call = mock.calls.find((item) => item.key === UPLOAD);
    expect(call?.url.searchParams.get('kind')).toBe('item');
    expect(call?.url.searchParams.get('brandId')).toBe(ids.pizza);
    expect(call?.contentType).toBe('image/png');
    expect(screen.getByRole('presentation', { hidden: true })).toHaveAttribute(
      'src',
      'https://files.test/pizza/item/a.png',
    );
  });

  it('refuses a file that is not a photo before sending it, and explains a server without storage', async () => {
    // applyAccept off: the browser's own file filter must not hide the check of the field.
    const user = userEvent.setup({ applyAccept: false });
    const mock = createApi(undefined, {
      [UPLOAD]: () => errorResponse(409, 'STORAGE_NOT_SET_UP'),
    });
    renderApp(`/admin/menu/items/new?brandId=${ids.pizza}`);
    await fillBasics(user);

    const input = screen.getByLabelText('Upload a photo');
    await user.upload(input, new File(['<svg/>'], 'v.svg', { type: 'image/svg+xml' }));
    expect(await screen.findByText('Choose a JPEG, PNG or WebP file.')).toBeInTheDocument();
    expect(mock.count(UPLOAD)).toBe(0);

    await user.upload(input, new File(['x'], 'v.png', { type: 'image/png' }));
    expect(
      await screen.findByText('Photo storage is not set up on this server. Paste a link instead.'),
    ).toBeInTheDocument();
    expect(mock.count(UPLOAD)).toBe(1);
  });

  it('asks for both descriptions when only one is written', async () => {
    const user = userEvent.setup();
    const mock = createApi();
    renderApp(`/admin/menu/items/new?brandId=${ids.pizza}`);
    await fillBasics(user);

    await user.type(screen.getByLabelText('Description (English)'), 'Fresh vegetables');
    await user.click(save());

    expect(screen.getByLabelText('Description (Arabic)')).toHaveAccessibleDescription(
      'Write the description in both languages, or leave both empty.',
    );
    expect(screen.getByLabelText('Description (English)')).not.toHaveAttribute('aria-invalid');
    expect(mock.count(CREATE)).toBe(0);
  });

  it('asks for the category, both names and the price before sending anything', async () => {
    const user = userEvent.setup();
    const mock = createApi();
    renderApp(`/admin/menu/items/new?brandId=${ids.pizza}`);
    await screen.findByLabelText('Category');

    await user.click(save());

    expect(screen.getByLabelText('Category')).toHaveAccessibleDescription('Choose a category.');
    expect(screen.getByLabelText('Name (English)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Name (Arabic)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Price')).toHaveAttribute('aria-invalid', 'true');
    expect(mock.count(CREATE)).toBe(0);
  });

  it.each(['12.5555', '-5', 'abc', '12,5'])('refuses the price %s', async (price) => {
    const user = userEvent.setup();
    const mock = createApi();
    renderApp(`/admin/menu/items/new?brandId=${ids.pizza}`);
    await fillBasics(user);

    await user.clear(screen.getByLabelText('Price'));
    await user.type(screen.getByLabelText('Price'), price);
    await user.click(save());

    expect(screen.getByLabelText('Price')).toHaveAccessibleDescription(
      /Enter a number with at most 3 decimals/,
    );
    expect(mock.count(CREATE)).toBe(0);
  });

  it('accepts a price typed with Arabic digits', async () => {
    const user = userEvent.setup();
    const mock = createApi();
    renderApp(`/admin/menu/items/new?brandId=${ids.pizza}`);
    await fillBasics(user);

    await user.clear(screen.getByLabelText('Price'));
    await user.type(screen.getByLabelText('Price'), '١٢٫٥');
    expect(screen.getByLabelText('Price')).toHaveValue('12.5');
    await user.click(save());

    await screen.findByRole('status');
    expect(bodyOf(mock, CREATE)).toMatchObject({ basePrice: '12.5' });
  });

  it('refuses an image link that is not a web link', async () => {
    const user = userEvent.setup();
    const mock = createApi();
    renderApp(`/admin/menu/items/new?brandId=${ids.pizza}`);
    await fillBasics(user);

    await user.type(screen.getByLabelText('Image link'), 'javascript:alert(1)');
    await user.click(save());

    expect(screen.getByLabelText('Image link')).toHaveAccessibleDescription(
      /Enter a web link that starts with http:\/\/ or https:\/\//,
    );
    expect(mock.count(CREATE)).toBe(0);
  });

  it('starts in the category the list was filtered by', async () => {
    createApi();
    renderApp(`/admin/menu/items/new?brandId=${ids.pizza}&categoryId=${categoryIds.drinks}`);

    expect(await screen.findByLabelText('Category')).toHaveValue(categoryIds.drinks);
  });

  it('starts with no category when the address names one the brand does not have', async () => {
    createApi();
    renderApp(
      `/admin/menu/items/new?brandId=${ids.pizza}&categoryId=01990000-0000-7000-8000-000000000999`,
    );

    expect(await screen.findByLabelText('Category')).toHaveValue('');
  });

  it('marks a category that is not active in the choice', async () => {
    createApi(undefined, {
      [CATEGORIES]: () => json({ data: [pizzasCategory, { ...sidesCategory, isActive: false }] }),
    });
    renderApp(`/admin/menu/items/new?brandId=${ids.pizza}`);

    const select = await screen.findByLabelText('Category');

    expect(within(select).getByRole('option', { name: 'Sides (inactive)' })).toBeInTheDocument();
  });

  it('can start the item as inactive, to set it up before it is sold', async () => {
    const user = userEvent.setup();
    const mock = createApi();
    renderApp(`/admin/menu/items/new?brandId=${ids.pizza}`);
    await fillBasics(user);

    await user.click(screen.getByRole('checkbox', { name: 'Active' }));
    await user.click(save());

    await screen.findByRole('status');
    expect(bodyOf(mock, CREATE)).toMatchObject({ isActive: false });
  });

  it('shows a problem the server finds on the field that has it', async () => {
    const user = userEvent.setup();
    createApi(() =>
      errorResponse(400, 'VALIDATION_ERROR', [
        { path: 'categoryId', message: 'CATEGORY_NOT_FOUND' },
      ]),
    );
    renderApp(`/admin/menu/items/new?brandId=${ids.pizza}`);
    await fillBasics(user);

    await user.click(save());

    expect(
      await screen.findByText('This category does not exist in this brand.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toHaveAttribute('aria-invalid', 'true');
  });

  it('says so when the item could not be saved, and when it is not allowed', async () => {
    const user = userEvent.setup();
    let status = 500;
    createApi(() =>
      status === 500 ? errorResponse(500, 'INTERNAL_ERROR') : errorResponse(403, 'FORBIDDEN'),
    );
    renderApp(`/admin/menu/items/new?brandId=${ids.pizza}`);
    await fillBasics(user);

    await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save. Try again.');

    status = 403;
    await user.click(save());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('You are not allowed to do this.'),
    );
  });

  it('is made in the brand a group admin chose', async () => {
    const user = userEvent.setup();
    const burgers = menuCategory({
      id: '01990000-0000-7000-8000-000000000411',
      brandId: ids.burger,
      name: { en: 'Burgers', ar: 'البرجر' },
    });
    const mock = mockApi({
      [REFRESH]: () => json(sessionFor(groupAdmin)),
      [BRANDS]: () => json(page([pizzaBrand, burgerBrand])),
      [branchesOf(ids.pizza)]: () => json(page([pizzaMall])),
      [branchesOf(ids.burger)]: () => json(page([burgerAirport])),
      [CATEGORIES]: ({ url }) =>
        json({ data: url.searchParams.get('brandId') === ids.burger ? [burgers] : categories }),
      [CREATE]: () => json({ ...created, brandId: ids.burger }, 201),
      [one(created.id)]: () => json({ ...created, brandId: ids.burger }),
    });
    renderApp(`/admin/menu/items/new?brandId=${ids.burger}`);

    await user.selectOptions(await screen.findByLabelText('Category'), burgers.id);
    await user.type(screen.getByLabelText('Name (English)'), 'Veggie');
    await user.type(screen.getByLabelText('Name (Arabic)'), 'خضار');
    await user.type(screen.getByLabelText('Price'), '28');
    await user.click(save());

    await screen.findByRole('status');
    expect(bodyOf(mock, CREATE)).toMatchObject({ brandId: ids.burger, categoryId: burgers.id });
    expect(screen.getByText('Burger Hub')).toBeInTheDocument();
  });

  it('is not offered to a person who may not change the menu', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor({ ...brandManager })),
      [BRANDS]: () => json(page([pizzaBrand])),
      [branchesOf(ids.pizza)]: () => json(page([pizzaMall])),
    });
    renderApp(`/admin/menu/items/new?brandId=${ids.pizza}`);

    expect(
      await screen.findByText('You do not have permission to open this page.'),
    ).toBeInTheDocument();
  });
});

describe('changing an item', () => {
  const open = async (id = itemIds.margherita) => {
    renderApp(`/admin/menu/items/${id}`);
    await screen.findByRole('heading', { name: 'Margherita' });
  };

  it('shows the item with its brand and its status, and fills the form with it', async () => {
    editApi(
      itemDetail({
        description: { en: 'Tomato and basil', ar: 'طماطم وريحان' },
        imageUrl: 'https://cdn.example.com/m.png',
      }),
    );
    await open();

    expect(await screen.findByText('Pizza Palace')).toBeInTheDocument();
    expect(screen.getAllByText('Active')[0]).toBeInTheDocument();
    expect(await screen.findByLabelText('Category')).toHaveValue(categoryIds.pizzas);
    expect(screen.getByLabelText('Name (English)')).toHaveValue('Margherita');
    expect(screen.getByLabelText('Name (Arabic)')).toHaveValue('مارجريتا');
    expect(screen.getByLabelText('Description (English)')).toHaveValue('Tomato and basil');
    expect(screen.getByLabelText('Description (Arabic)')).toHaveValue('طماطم وريحان');
    expect(screen.getByLabelText('Price')).toHaveValue('25.000');
    expect(screen.getByLabelText('Image link')).toHaveValue('https://cdn.example.com/m.png');
    expect(screen.getByLabelText('Name (Arabic)')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByLabelText('Price')).toHaveAttribute('dir', 'ltr');
  });

  it('goes back to the list of the brand', async () => {
    editApi();
    await open();

    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      `/admin/menu/items?brandId=${ids.pizza}`,
    );
  });

  it('sends only the price when only the price changed', async () => {
    const user = userEvent.setup();
    const mock = editApi(itemDetail(), {
      [patch(itemIds.margherita)]: () => json(itemDetail({ basePrice: '27.000' })),
    });
    await open();

    const price = await screen.findByLabelText('Price');
    await user.clear(price);
    await user.type(price, '27');
    await user.click(save());

    expect(await screen.findByRole('status')).toHaveTextContent('Changes saved.');
    expect(bodyOf(mock, patch(itemIds.margherita))).toEqual({ basePrice: '27' });
  });

  it('treats 25.5 and 25.500 as the same price, and sends nothing', async () => {
    const user = userEvent.setup();
    const mock = editApi(itemDetail({ basePrice: '25.500' }));
    await open();

    const price = await screen.findByLabelText('Price');
    await user.clear(price);
    await user.type(price, '25.5');
    await user.click(save());

    expect(await screen.findByRole('status')).toHaveTextContent('Changes saved.');
    expect(mock.count(patch(itemIds.margherita))).toBe(0);
  });

  it('sends nothing when nothing changed', async () => {
    const user = userEvent.setup();
    const mock = editApi();
    await open();

    await user.click(await screen.findByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Changes saved.');
    expect(mock.count(patch(itemIds.margherita))).toBe(0);
  });

  it('sends both names when one of them changed', async () => {
    const user = userEvent.setup();
    const mock = editApi(itemDetail(), {
      [patch(itemIds.margherita)]: () =>
        json(itemDetail({ name: { en: 'Margarita', ar: 'مارجريتا' } })),
    });
    await open();

    const english = await screen.findByLabelText('Name (English)');
    await user.clear(english);
    await user.type(english, 'Margarita');
    await user.click(save());

    await screen.findByRole('status');
    expect(bodyOf(mock, patch(itemIds.margherita))).toEqual({
      name: { en: 'Margarita', ar: 'مارجريتا' },
    });
  });

  it('moves the item to another category', async () => {
    const user = userEvent.setup();
    const mock = editApi(itemDetail(), {
      [patch(itemIds.margherita)]: () => json(itemDetail({ categoryId: categoryIds.sides })),
    });
    await open();

    await user.selectOptions(await screen.findByLabelText('Category'), categoryIds.sides);
    await user.click(save());

    await screen.findByRole('status');
    expect(bodyOf(mock, patch(itemIds.margherita))).toEqual({ categoryId: categoryIds.sides });
  });

  it('sends a new description in both languages', async () => {
    const user = userEvent.setup();
    const mock = editApi(itemDetail(), {
      [patch(itemIds.margherita)]: () =>
        json(itemDetail({ description: { en: 'Tomato', ar: 'طماطم' } })),
    });
    await open();

    await user.type(await screen.findByLabelText('Description (English)'), 'Tomato');
    await user.type(screen.getByLabelText('Description (Arabic)'), 'طماطم');
    await user.click(save());

    await screen.findByRole('status');
    expect(bodyOf(mock, patch(itemIds.margherita))).toEqual({
      description: { en: 'Tomato', ar: 'طماطم' },
    });
  });

  it('clears the description and the image link when they are emptied', async () => {
    const user = userEvent.setup();
    const mock = editApi(
      itemDetail({
        description: { en: 'Tomato', ar: 'طماطم' },
        imageUrl: 'https://cdn.example.com/m.png',
      }),
      { [patch(itemIds.margherita)]: () => json(itemDetail()) },
    );
    await open();

    await user.clear(await screen.findByLabelText('Description (English)'));
    await user.clear(screen.getByLabelText('Description (Arabic)'));
    await user.clear(screen.getByLabelText('Image link'));
    await user.click(save());

    await screen.findByRole('status');
    expect(bodyOf(mock, patch(itemIds.margherita))).toEqual({ description: null, imageUrl: null });
  });

  it('shows a problem the server finds on the field that has it', async () => {
    const user = userEvent.setup();
    editApi(itemDetail(), {
      [patch(itemIds.margherita)]: () =>
        errorResponse(400, 'VALIDATION_ERROR', [{ path: 'basePrice', message: 'PRICE_INVALID' }]),
    });
    await open();

    const price = await screen.findByLabelText('Price');
    await user.clear(price);
    await user.type(price, '30');
    await user.click(save());

    expect(await screen.findByText(/Enter a number with at most 3 decimals/)).toBeInTheDocument();
    expect(price).toHaveAttribute('aria-invalid', 'true');
  });

  it('deactivates the item and activates it again, and never deletes it', async () => {
    const user = userEvent.setup();
    let isActive = true;
    const mock = editApi(itemDetail(), {
      [patch(itemIds.margherita)]: () => {
        isActive = !isActive;
        return json(itemDetail({ isActive }));
      },
    });
    await open();
    expect(screen.queryByRole('button', { name: /delete|remove/i })).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Deactivate' }));

    expect(
      await screen.findByText('The item is deactivated. It is no longer sold.'),
    ).toBeInTheDocument();
    expect(bodyOf(mock, patch(itemIds.margherita))).toEqual({ isActive: false });
    expect(screen.getAllByText('Inactive').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Activate' }));

    expect(await screen.findByText('The item is active again.')).toBeInTheDocument();
  });

  it('shows a person who may not change the menu the item, and nothing to change it with', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor({ ...brandManager })),
      [BRANDS]: () => json(page([pizzaBrand])),
      [branchesOf(ids.pizza)]: () => json(page([pizzaMall])),
      [CATEGORIES]: () => json({ data: categories }),
      [one(itemIds.margherita)]: () => json(itemDetail()),
    });
    await open();

    expect(
      await screen.findByText('You can see this item but you cannot change it.'),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText('Name (English)')).toBeDisabled();
    expect(screen.getByLabelText('Price')).toBeDisabled();
    expect(screen.getByLabelText('Category')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
  });

  it('says so when the item does not exist', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(fullBrandManager)),
      [BRANDS]: () => json(page([pizzaBrand])),
      [branchesOf(ids.pizza)]: () => json(page([pizzaMall])),
      [one(itemIds.margherita)]: () => errorResponse(404, 'NOT_FOUND'),
    });
    renderApp(`/admin/menu/items/${itemIds.margherita}`);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the data.');
  });

  it('shows the form in Arabic', async () => {
    await i18n.changeLanguage('ar');
    editApi();
    renderApp(`/admin/menu/items/${itemIds.margherita}`);

    expect(await screen.findByRole('heading', { name: 'مارجريتا' })).toBeInTheDocument();
    expect(await screen.findByLabelText('السعر')).toHaveValue('25.000');
    expect(screen.getByLabelText('الوصف (بالعربية)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إيقاف' })).toBeInTheDocument();
  });
});
