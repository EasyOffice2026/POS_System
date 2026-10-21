import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  brandManager,
  burgerBrand,
  fullBrandManager,
  groupAdmin,
  page,
  pizzaBrand,
  sessionFor,
} from '../../test/fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const REFRESH = 'POST /api/v1/auth/refresh';
const LIST = 'GET /api/v1/brands';
const CREATE = 'POST /api/v1/brands';
const one = (id: string) => `GET /api/v1/brands/${id}`;
const patch = (id: string) => `PATCH /api/v1/brands/${id}`;
const UPLOAD = 'POST /api/v1/uploads/images';

const noodles = {
  ...pizzaBrand,
  id: '01990000-0000-7000-8000-000000000003',
  name: { en: 'Noodle House', ar: 'بيت النودلز' },
};

const bodyOf = (api: ReturnType<typeof mockApi>, key: string) =>
  api.calls.find((call) => call.key === key)?.body;

function createApi(create: MockHandler = () => json(noodles, 201)) {
  return mockApi({
    [REFRESH]: () => json(sessionFor(groupAdmin)),
    [LIST]: () => json(page([pizzaBrand, noodles])),
    [CREATE]: create,
  });
}

function editApi(brand = pizzaBrand, extra: Record<string, MockHandler> = {}) {
  return mockApi({
    [REFRESH]: () => json(sessionFor(groupAdmin)),
    [one(brand.id)]: () => json(brand),
    ...extra,
  });
}

type User = ReturnType<typeof userEvent.setup>;

async function fillNames(user: User, en = 'Noodle House', ar = 'بيت النودلز') {
  await user.type(await screen.findByLabelText('Name (English)'), en);
  await user.type(screen.getByLabelText('Name (Arabic)'), ar);
}

describe('the logo', () => {
  it('cannot be uploaded before the brand is saved', async () => {
    createApi();
    renderApp('/admin/brands/new');

    expect(await screen.findByLabelText('Logo link')).toHaveAccessibleDescription(
      'A link to a picture. Save the brand first to upload a file.',
    );
    expect(screen.queryByLabelText('Upload a photo')).not.toBeInTheDocument();
  });

  it('is uploaded for the brand being edited', async () => {
    const user = userEvent.setup();
    const api = editApi(pizzaBrand, {
      [UPLOAD]: () => json({ url: 'https://files.test/pizza/logo/l.webp' }, 201),
    });
    renderApp(`/admin/brands/${pizzaBrand.id}`);

    await user.upload(
      await screen.findByLabelText('Upload a photo'),
      new File(['x'], 'logo.webp', { type: 'image/webp' }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Logo link')).toHaveValue(
        'https://files.test/pizza/logo/l.webp',
      ),
    );
    const call = api.calls.find((item) => item.key === UPLOAD);
    expect(call?.url.searchParams.get('kind')).toBe('logo');
    expect(call?.url.searchParams.get('brandId')).toBe(pizzaBrand.id);
    expect(call?.contentType).toBe('image/webp');
  });
});

describe('creating a brand', () => {
  it('sends both names, and goes back to the list with a notice', async () => {
    const user = userEvent.setup();
    const api = createApi();
    renderApp('/admin/brands/new');
    await fillNames(user);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Brand created.');
    expect(bodyOf(api, CREATE)).toEqual({
      name: { en: 'Noodle House', ar: 'بيت النودلز' },
      isActive: true,
    });
    expect(await screen.findByRole('link', { name: 'Noodle House' })).toBeInTheDocument();
  });

  it('asks for both names before sending anything, and says which one is missing', async () => {
    const user = userEvent.setup();
    const api = createApi();
    renderApp('/admin/brands/new');
    await user.type(await screen.findByLabelText('Name (English)'), 'Noodle House');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByLabelText('Name (Arabic)')).toHaveAccessibleDescription(
      'Enter the name in this language.',
    );
    expect(screen.getByLabelText('Name (English)')).not.toHaveAttribute('aria-invalid');
    expect(api.count(CREATE)).toBe(0);
  });

  it('counts a name of only spaces as missing', async () => {
    const user = userEvent.setup();
    const api = createApi();
    renderApp('/admin/brands/new');
    await fillNames(user, '   ', 'بيت النودلز');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByLabelText('Name (English)')).toHaveAttribute('aria-invalid', 'true');
    expect(api.count(CREATE)).toBe(0);
  });

  it('sends a logo link, and refuses one that is not a web link', async () => {
    const user = userEvent.setup();
    const api = createApi();
    renderApp('/admin/brands/new');
    await fillNames(user);

    await user.type(screen.getByLabelText('Logo link'), 'javascript:alert(1)');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByLabelText('Logo link')).toHaveAccessibleDescription(
      /Enter a web link that starts with http:\/\/ or https:\/\//,
    );
    expect(api.count(CREATE)).toBe(0);

    await user.clear(screen.getByLabelText('Logo link'));
    await user.type(screen.getByLabelText('Logo link'), 'https://cdn.example.com/noodles.png');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('status');
    expect(bodyOf(api, CREATE)).toMatchObject({ logoUrl: 'https://cdn.example.com/noodles.png' });
  });

  it('can start the brand as inactive, to set it up before it opens', async () => {
    const user = userEvent.setup();
    const api = createApi();
    renderApp('/admin/brands/new');
    await fillNames(user);

    await user.click(screen.getByRole('checkbox', { name: 'Active' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('status');
    expect(bodyOf(api, CREATE)).toMatchObject({ isActive: false });
  });

  it('shows a problem the server finds on the field that has it', async () => {
    const user = userEvent.setup();
    createApi(() =>
      errorResponse(400, 'VALIDATION_ERROR', [{ path: 'name.ar', message: 'NAME_TOO_LONG' }]),
    );
    renderApp('/admin/brands/new');
    await fillNames(user);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('A name can have at most 100 characters.')).toBeInTheDocument();
    expect(screen.getByLabelText('Name (Arabic)')).toHaveAttribute('aria-invalid', 'true');
  });

  it('says so when the brand could not be saved, and when it is not allowed', async () => {
    const user = userEvent.setup();
    let status = 500;
    createApi(() =>
      status === 500 ? errorResponse(500, 'INTERNAL_ERROR') : errorResponse(403, 'FORBIDDEN'),
    );
    renderApp('/admin/brands/new');
    await fillNames(user);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save. Try again.');

    status = 403;
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('You are not allowed to do this.'),
    );
  });

  it('writes each name in its own direction, whatever the language of the screen', async () => {
    createApi();
    renderApp('/admin/brands/new');

    expect(await screen.findByLabelText('Name (English)')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByLabelText('Name (Arabic)')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByLabelText('Logo link')).toHaveAttribute('dir', 'ltr');
  });

  it('is written in Arabic when the language is switched, and keeps what was typed', async () => {
    const user = userEvent.setup();
    createApi();
    renderApp('/admin/brands/new');
    await user.type(await screen.findByLabelText('Name (English)'), 'Noodle');

    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    expect(await screen.findByRole('heading', { name: 'علامة تجارية جديدة' })).toBeInTheDocument();
    expect(screen.getByLabelText('الاسم (بالإنجليزية)')).toHaveValue('Noodle');
    expect(screen.getByLabelText('رابط الشعار')).toBeInTheDocument();
  });

  it('keeps the message in step with the language after a problem was shown', async () => {
    const user = userEvent.setup();
    createApi();
    renderApp('/admin/brands/new');
    await screen.findByLabelText('Name (English)');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findAllByText('Enter the name in this language.')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    expect(await screen.findAllByText('أدخل الاسم بهذه اللغة.')).toHaveLength(2);
  });
});

describe('changing a brand', () => {
  const withLogo = { ...pizzaBrand, logoUrl: 'https://cdn.example.com/pizza.png' };

  it('shows what is stored', async () => {
    editApi(withLogo);
    renderApp(`/admin/brands/${pizzaBrand.id}`);

    expect(await screen.findByRole('heading', { name: 'Edit brand' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Name (English)')).toHaveValue('Pizza Palace');
    expect(screen.getByLabelText('Name (Arabic)')).toHaveValue('بيتزا بالاس');
    expect(screen.getByLabelText('Logo link')).toHaveValue('https://cdn.example.com/pizza.png');
    expect(screen.queryByRole('checkbox', { name: 'Active' })).not.toBeInTheDocument();
  });

  it('sends only what changed', async () => {
    const user = userEvent.setup();
    const api = editApi(pizzaBrand, {
      [patch(pizzaBrand.id)]: () =>
        json({ ...pizzaBrand, name: { en: 'Pizza Palace Group', ar: pizzaBrand.name.ar } }),
    });
    renderApp(`/admin/brands/${pizzaBrand.id}`);
    const english = await screen.findByLabelText('Name (English)');

    await user.type(english, ' Group');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    expect(bodyOf(api, patch(pizzaBrand.id))).toEqual({
      name: { en: 'Pizza Palace Group', ar: 'بيتزا بالاس' },
    });
  });

  it('clears the logo with null when the field is emptied', async () => {
    const user = userEvent.setup();
    const api = editApi(withLogo, {
      [patch(pizzaBrand.id)]: () => json({ ...withLogo, logoUrl: null }),
    });
    renderApp(`/admin/brands/${pizzaBrand.id}`);

    await user.clear(await screen.findByLabelText('Logo link'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Changes saved.');
    expect(bodyOf(api, patch(pizzaBrand.id))).toEqual({ logoUrl: null });
  });

  it('sends nothing, and still says it is saved, when nothing changed', async () => {
    const user = userEvent.setup();
    const api = editApi();
    renderApp(`/admin/brands/${pizzaBrand.id}`);
    await screen.findByLabelText('Name (English)');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    expect(api.count(patch(pizzaBrand.id))).toBe(0);
  });

  it('refuses a name that was emptied, before asking the server', async () => {
    const user = userEvent.setup();
    const api = editApi();
    renderApp(`/admin/brands/${pizzaBrand.id}`);

    await user.clear(await screen.findByLabelText('Name (Arabic)'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByLabelText('Name (Arabic)')).toHaveAttribute('aria-invalid', 'true');
    expect(api.count(patch(pizzaBrand.id))).toBe(0);
  });

  it('says so when the brand cannot be loaded', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(groupAdmin)),
      [one(pizzaBrand.id)]: () => errorResponse(404, 'NOT_FOUND'),
    });
    renderApp(`/admin/brands/${pizzaBrand.id}`);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the data.');
  });

  it('says that the item cannot be found when it is gone by the time it is saved', async () => {
    const user = userEvent.setup();
    editApi(pizzaBrand, { [patch(pizzaBrand.id)]: () => errorResponse(404, 'NOT_FOUND') });
    renderApp(`/admin/brands/${pizzaBrand.id}`);

    await user.type(await screen.findByLabelText('Logo link'), 'https://x.io/a.png');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This item does not exist, or you cannot see it.',
    );
  });
});

describe('deactivating and activating a brand', () => {
  it('deactivates the brand, and then offers to activate it again', async () => {
    const user = userEvent.setup();
    const api = editApi(pizzaBrand, {
      [patch(pizzaBrand.id)]: () => json({ ...pizzaBrand, isActive: false }),
    });
    renderApp(`/admin/brands/${pizzaBrand.id}`);

    await user.click(await screen.findByRole('button', { name: 'Deactivate' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The brand is deactivated.');
    expect(bodyOf(api, patch(pizzaBrand.id))).toEqual({ isActive: false });
    expect(await screen.findByRole('button', { name: 'Activate' })).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('activates a brand that was deactivated', async () => {
    const user = userEvent.setup();
    const inactive = { ...burgerBrand, isActive: false };
    const api = editApi(inactive, {
      [patch(inactive.id)]: () => json({ ...inactive, isActive: true }),
    });
    renderApp(`/admin/brands/${inactive.id}`);

    await user.click(await screen.findByRole('button', { name: 'Activate' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The brand is active again.');
    expect(bodyOf(api, patch(inactive.id))).toEqual({ isActive: true });
  });

  it('says what deactivating does, in plain words', async () => {
    editApi();
    renderApp(`/admin/brands/${pizzaBrand.id}`);

    expect(await screen.findByText(/keeps its branches, people and history/)).toBeInTheDocument();
  });

  it('says when the change is refused', async () => {
    const user = userEvent.setup();
    editApi(pizzaBrand, { [patch(pizzaBrand.id)]: () => errorResponse(403, 'FORBIDDEN') });
    renderApp(`/admin/brands/${pizzaBrand.id}`);

    await user.click(await screen.findByRole('button', { name: 'Deactivate' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('You are not allowed to do this.');
  });

  it('links to the branches of the brand', async () => {
    editApi();
    renderApp(`/admin/brands/${pizzaBrand.id}`);

    expect(await screen.findByRole('link', { name: 'View branches' })).toHaveAttribute(
      'href',
      `/admin/branches?brandId=${pizzaBrand.id}`,
    );
  });
});

describe('who may change brands', () => {
  it('tells a brand manager they may not create a brand', async () => {
    const api = mockApi({ [REFRESH]: () => json(sessionFor(fullBrandManager)) });

    renderApp('/admin/brands/new');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to open this page.',
    );
    expect(api.count(CREATE)).toBe(0);
  });

  it('tells a brand manager they may not open the form of their own brand', async () => {
    const api = mockApi({ [REFRESH]: () => json(sessionFor(brandManager)) });

    renderApp(`/admin/brands/${pizzaBrand.id}`);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to open this page.',
    );
    // The form never opens: no field of it is shown and nothing is saved.
    expect(screen.queryByLabelText('Name (English)')).not.toBeInTheDocument();
    expect(api.count(patch(pizzaBrand.id))).toBe(0);
  });
});
