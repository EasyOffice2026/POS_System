import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  brandManager,
  burgerBrand,
  groupAdmin,
  ids,
  page,
  pizzaBrand,
  pizzaDowntown,
  pizzaMall,
  rolesFor,
  sara,
  sessionFor,
} from '../../test/fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const REFRESH = 'POST /api/v1/auth/refresh';
const CREATE = 'POST /api/v1/users';

const directory: Record<string, MockHandler> = {
  'GET /api/v1/brands': () => json(page([pizzaBrand, burgerBrand])),
  [`GET /api/v1/brands/${pizzaBrand.id}/branches`]: () => json(page([pizzaMall, pizzaDowntown])),
  [`GET /api/v1/brands/${burgerBrand.id}/branches`]: () => json(page([])),
};

function groupAdminApi(create: MockHandler = () => json(sara, 201)) {
  return mockApi({
    [REFRESH]: () => json(sessionFor(groupAdmin)),
    'GET /api/v1/roles': () => json({ data: rolesFor('group') }),
    'GET /api/v1/users': () => json(page([sara])),
    [CREATE]: create,
    ...directory,
  });
}

function brandManagerApi(create: MockHandler = () => json(sara, 201)) {
  const manager = {
    ...brandManager,
    permissions: [
      ...brandManager.permissions,
      'users:read' as const,
      'users:write' as const,
      'roles:read' as const,
    ],
  };
  return mockApi({
    [REFRESH]: () => json(sessionFor(manager)),
    'GET /api/v1/roles': () => json({ data: rolesFor('brand') }),
    'GET /api/v1/users': () => json(page([sara])),
    [CREATE]: create,
    'GET /api/v1/brands': () => json(page([pizzaBrand])),
    [`GET /api/v1/brands/${pizzaBrand.id}/branches`]: () => json(page([pizzaMall, pizzaDowntown])),
  });
}

type User = ReturnType<typeof userEvent.setup>;

async function fillNewCashier(user: User) {
  await user.type(await screen.findByLabelText('Name'), 'New Cashier');
  await user.selectOptions(screen.getByLabelText('Role'), 'cashier');
  await user.selectOptions(await screen.findByLabelText('Brand'), ids.pizza);
  await user.click(await screen.findByLabelText('Pizza Palace - Mall Branch'));
  await user.type(screen.getByLabelText('Staff code'), '2001');
}

describe('creating a person as a group admin', () => {
  it('sends the name, role, brand, branch, staff code and PIN, then returns to the list', async () => {
    const user = userEvent.setup();
    const api = groupAdminApi();
    const { router } = renderApp('/admin/users/new');

    await fillNewCashier(user);
    await user.type(await screen.findByLabelText('PIN'), '7391');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.count(CREATE)).toBe(1));
    expect(api.calls.find((call) => call.key === CREATE)?.body).toEqual({
      name: 'New Cashier',
      roleKey: 'cashier',
      preferredLang: 'en',
      branchIds: [ids.pizzaMall],
      staffCode: '2001',
      brandId: ids.pizza,
      pin: '7391',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('User created.');
    expect(router.state.location.pathname).toBe('/admin/users');
  });

  it('marks a brand and a branch that are not active in the choices', async () => {
    const user = userEvent.setup();
    mockApi({
      [REFRESH]: () => json(sessionFor(groupAdmin)),
      'GET /api/v1/roles': () => json({ data: rolesFor('group') }),
      'GET /api/v1/users': () => json(page([sara])),
      'GET /api/v1/brands': () => json(page([pizzaBrand, { ...burgerBrand, isActive: false }])),
      [`GET /api/v1/brands/${pizzaBrand.id}/branches`]: () =>
        json(page([pizzaMall, { ...pizzaDowntown, isActive: false }])),
      [`GET /api/v1/brands/${burgerBrand.id}/branches`]: () => json(page([])),
    });
    renderApp('/admin/users/new');
    await screen.findByLabelText('Name');
    await user.selectOptions(screen.getByLabelText('Role'), 'cashier');

    const brand = await screen.findByLabelText('Brand');
    expect(
      within(brand).getByRole('option', { name: 'Burger Hub (inactive)' }),
    ).toBeInTheDocument();
    expect(within(brand).getByRole('option', { name: 'Pizza Palace' })).toBeInTheDocument();

    await user.selectOptions(brand, ids.pizza);
    expect(
      await screen.findByLabelText('Pizza Palace - Downtown Branch (inactive)'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Pizza Palace - Mall Branch')).toBeInTheDocument();
  });

  it('leaves out what was not filled in', async () => {
    const user = userEvent.setup();
    const api = groupAdminApi();
    renderApp('/admin/users/new');

    await user.type(await screen.findByLabelText('Name'), 'Mo Marketing');
    await user.selectOptions(screen.getByLabelText('Role'), 'marketing');
    await user.selectOptions(await screen.findByLabelText('Brand'), ids.burger);
    await user.type(screen.getByLabelText('Email'), 'mo@pos.local');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.count(CREATE)).toBe(1));
    expect(api.calls.find((call) => call.key === CREATE)?.body).toEqual({
      name: 'Mo Marketing',
      roleKey: 'marketing',
      preferredLang: 'en',
      branchIds: [],
      email: 'mo@pos.local',
      brandId: ids.burger,
    });
  });

  it('asks for no brand for a group admin', async () => {
    const user = userEvent.setup();
    groupAdminApi();
    renderApp('/admin/users/new');
    await screen.findByLabelText('Name');

    await user.selectOptions(screen.getByLabelText('Role'), 'group_admin');

    expect(screen.queryByLabelText('Brand')).not.toBeInTheDocument();
    expect(screen.queryByText('Branches', { selector: 'legend' })).not.toBeInTheDocument();
  });

  it('shows the brand and branches only for the roles that need them', async () => {
    const user = userEvent.setup();
    groupAdminApi();
    renderApp('/admin/users/new');
    await screen.findByLabelText('Name');
    expect(screen.queryByLabelText('Brand')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Role'), 'brand_manager');
    expect(await screen.findByLabelText('Brand')).toBeInTheDocument();
    expect(screen.queryByText('Branches', { selector: 'legend' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Role'), 'cashier');
    expect(screen.getByText('Branches', { selector: 'legend' })).toBeInTheDocument();
  });

  it('lists only the branches of the chosen brand, and clears the choice when the brand changes', async () => {
    const user = userEvent.setup();
    groupAdminApi();
    renderApp('/admin/users/new');
    await user.selectOptions(await screen.findByLabelText('Role'), 'cashier');
    await user.selectOptions(await screen.findByLabelText('Brand'), ids.pizza);
    await user.click(await screen.findByLabelText('Pizza Palace - Mall Branch'));
    expect(screen.getByLabelText('Pizza Palace - Mall Branch')).toBeChecked();

    await user.selectOptions(screen.getByLabelText('Brand'), ids.burger);

    expect(screen.queryByLabelText('Pizza Palace - Mall Branch')).not.toBeInTheDocument();
    expect(screen.getByText('There are no branches in this brand yet.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Brand'), ids.pizza);
    expect(screen.getByLabelText('Pizza Palace - Mall Branch')).not.toBeChecked();
  });

  it('clears the branches when the role no longer needs them', async () => {
    const user = userEvent.setup();
    const api = groupAdminApi();
    renderApp('/admin/users/new');
    await user.type(await screen.findByLabelText('Name'), 'X');
    await user.selectOptions(screen.getByLabelText('Role'), 'cashier');
    await user.selectOptions(await screen.findByLabelText('Brand'), ids.pizza);
    await user.click(await screen.findByLabelText('Pizza Palace - Mall Branch'));
    await user.type(screen.getByLabelText('Email'), 'x@pos.local');

    await user.selectOptions(screen.getByLabelText('Role'), 'marketing');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.count(CREATE)).toBe(1));
    expect(api.calls.find((call) => call.key === CREATE)?.body).toMatchObject({ branchIds: [] });
  });

  it('shows the password field once there is an email, and the PIN field only for branch roles with a staff code', async () => {
    const user = userEvent.setup();
    groupAdminApi();
    renderApp('/admin/users/new');
    await user.selectOptions(await screen.findByLabelText('Role'), 'marketing');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Email'), 'mo@pos.local');
    await user.type(screen.getByLabelText('Staff code'), '77');
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByLabelText('PIN')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Role'), 'cashier');
    expect(screen.getByLabelText('PIN')).toBeInTheDocument();
  });

  it('offers English and Arabic as the language of the person', async () => {
    groupAdminApi();
    renderApp('/admin/users/new');

    const options = within(await screen.findByLabelText('Language')).getAllByRole('option');

    expect(options.map((option) => option.textContent)).toEqual(['English', 'العربية']);
  });
});

describe('creating a person as a brand manager', () => {
  it('asks for no brand, and sends none, because the person joins the manager’s own brand', async () => {
    const user = userEvent.setup();
    const api = brandManagerApi();
    renderApp('/admin/users/new');

    await user.type(await screen.findByLabelText('Name'), 'Kim Kitchen');
    await user.selectOptions(screen.getByLabelText('Role'), 'kitchen');
    expect(screen.queryByLabelText('Brand')).not.toBeInTheDocument();
    await user.click(await screen.findByLabelText('Pizza Palace - Downtown Branch'));
    await user.type(screen.getByLabelText('Staff code'), '2002');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.count(CREATE)).toBe(1));
    const body = api.calls.find((call) => call.key === CREATE)?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      roleKey: 'kitchen',
      branchIds: [ids.pizzaDowntown],
      staffCode: '2002',
    });
    expect(body).not.toHaveProperty('brandId');
  });

  it('does not offer the group admin role', async () => {
    brandManagerApi();
    renderApp('/admin/users/new');

    const options = within(await screen.findByLabelText('Role')).getAllByRole('option');

    expect(options.map((option) => option.textContent)).not.toContain('Group Admin');
    expect(options).toHaveLength(7);
  });
});

describe('problems the form finds before it asks the server', () => {
  it('asks for a name, a role and a way to sign in', async () => {
    const user = userEvent.setup();
    const api = groupAdminApi();
    renderApp('/admin/users/new');
    await screen.findByLabelText('Name');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getAllByText('This field is required.')).toHaveLength(2);
    expect(screen.getByText('Give an email or a staff code.')).toBeInTheDocument();
    expect(api.count(CREATE)).toBe(0);
  });

  it('asks for a brand and a branch', async () => {
    const user = userEvent.setup();
    const api = groupAdminApi();
    renderApp('/admin/users/new');
    await user.type(await screen.findByLabelText('Name'), 'X');
    await user.selectOptions(screen.getByLabelText('Role'), 'cashier');
    await user.type(screen.getByLabelText('Staff code'), '5');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Choose a brand.')).toBeInTheDocument();
    expect(screen.getByText('Pick at least one branch.')).toBeInTheDocument();
    expect(api.count(CREATE)).toBe(0);
  });

  it('checks the email, the PIN and the password with the rules the server uses', async () => {
    const user = userEvent.setup();
    const api = groupAdminApi();
    renderApp('/admin/users/new');
    await fillNewCashier(user);
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.type(await screen.findByLabelText('Password'), 'short');
    await user.type(await screen.findByLabelText('PIN'), '1234');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Enter a valid email.')).toBeInTheDocument();
    expect(screen.getByText('A password needs at least 10 characters.')).toBeInTheDocument();
    expect(screen.getByText('A PIN cannot be a straight run such as 1234.')).toBeInTheDocument();
    expect(api.count(CREATE)).toBe(0);
  });

  it('marks the fields that have a problem for screen readers', async () => {
    const user = userEvent.setup();
    groupAdminApi();
    renderApp('/admin/users/new');
    await screen.findByLabelText('Name');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    const name = screen.getByLabelText('Name');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('This field is required.');
  });

  it('writes the problems in Arabic when the language is switched', async () => {
    const user = userEvent.setup();
    groupAdminApi();
    renderApp('/admin/users/new');
    await screen.findByLabelText('Name');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    expect(screen.getAllByText('هذا الحقل مطلوب.')).toHaveLength(2);
    expect(screen.getByText('أدخل بريداً إلكترونياً أو رمز موظف.')).toBeInTheDocument();
  });
});

describe('problems the server finds', () => {
  async function submitMarketing(user: User) {
    await user.type(await screen.findByLabelText('Name'), 'Mo Marketing');
    await user.selectOptions(screen.getByLabelText('Role'), 'marketing');
    await user.selectOptions(await screen.findByLabelText('Brand'), ids.pizza);
    await user.type(screen.getByLabelText('Email'), 'mo@pos.local');
    await user.click(screen.getByRole('button', { name: 'Save' }));
  }

  it('says when the email is already used, next to the email', async () => {
    const user = userEvent.setup();
    groupAdminApi(() => errorResponse(409, 'EMAIL_TAKEN'));
    renderApp('/admin/users/new');

    await submitMarketing(user);

    expect(await screen.findByText('This email is already used.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('says when the staff code is already used, next to the staff code', async () => {
    const user = userEvent.setup();
    groupAdminApi(() => errorResponse(409, 'STAFF_CODE_TAKEN'));
    renderApp('/admin/users/new');
    await fillNewCashier(user);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('This staff code is already used.')).toBeInTheDocument();
  });

  it('puts the problems the server lists on the fields they name', async () => {
    const user = userEvent.setup();
    groupAdminApi(() =>
      errorResponse(400, 'VALIDATION_ERROR', [
        { path: 'branchIds', message: 'BRANCH_NOT_FOUND' },
        { path: 'pin', message: 'PIN_ONLY_FOR_BRANCH_ROLES' },
      ]),
    );
    renderApp('/admin/users/new');
    await fillNewCashier(user);
    await user.type(await screen.findByLabelText('PIN'), '7391');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('A chosen branch does not exist in this brand.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Only branch roles sign in with a PIN.')).toBeInTheDocument();
  });

  it('shows a problem with the whole form when the person is not allowed', async () => {
    const user = userEvent.setup();
    groupAdminApi(() => errorResponse(403, 'FORBIDDEN'));
    renderApp('/admin/users/new');

    await submitMarketing(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('You are not allowed to do this.');
  });

  it('says that something went wrong for an error it does not know', async () => {
    const user = userEvent.setup();
    groupAdminApi(() => errorResponse(500, 'INTERNAL_ERROR'));
    renderApp('/admin/users/new');

    await submitMarketing(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save. Try again.');
  });

  it('says that the server cannot be reached', async () => {
    const user = userEvent.setup();
    groupAdminApi(() => {
      throw new TypeError('Failed to fetch');
    });
    renderApp('/admin/users/new');

    await submitMarketing(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server.');
  });

  it('keeps what was typed after a problem, so nothing is lost', async () => {
    const user = userEvent.setup();
    groupAdminApi(() => errorResponse(409, 'EMAIL_TAKEN'));
    renderApp('/admin/users/new');

    await submitMarketing(user);
    await screen.findByText('This email is already used.');

    expect(screen.getByLabelText('Name')).toHaveValue('Mo Marketing');
    expect(screen.getByLabelText('Email')).toHaveValue('mo@pos.local');
  });

  it('shows the saving state, and does not send twice', async () => {
    const user = userEvent.setup();
    const api = groupAdminApi(() => new Promise<Response>(() => undefined));
    renderApp('/admin/users/new');
    await user.type(await screen.findByLabelText('Name'), 'Mo Marketing');
    await user.selectOptions(screen.getByLabelText('Role'), 'marketing');
    await user.selectOptions(await screen.findByLabelText('Brand'), ids.pizza);
    await user.type(screen.getByLabelText('Email'), 'mo@pos.local');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    const button = await screen.findByRole('button', { name: 'Saving…' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(api.count(CREATE)).toBe(1);
  });
});

describe('the form for a person who cannot create', () => {
  it('tells a branch manager they may not open it', async () => {
    mockApi({
      [REFRESH]: () =>
        json(
          sessionFor({
            ...brandManager,
            role: { key: 'branch_manager', name: 'Branch Manager' },
            permissions: ['users:read'],
          }),
        ),
    });
    renderApp('/admin/users/new');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to open this page.',
    );
  });
});
