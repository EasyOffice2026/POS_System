import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { formatDateTime } from '../../i18n/format';
import {
  branchManager,
  brandManager,
  burgerBrand,
  cashier,
  dana,
  groupAdmin,
  lockedUser,
  mahaManager,
  page,
  pizzaBrand,
  pizzaDowntown,
  pizzaMall,
  sara,
  sessionFor,
} from '../../test/fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const REFRESH = 'POST /api/v1/auth/refresh';
const USERS = 'GET /api/v1/users';

// What the page asks for besides the users: the brands and branches for the branch names.
const directory: Record<string, MockHandler> = {
  'GET /api/v1/brands': () => json(page([pizzaBrand, burgerBrand])),
  [`GET /api/v1/brands/${pizzaBrand.id}/branches`]: () => json(page([pizzaMall, pizzaDowntown])),
  [`GET /api/v1/brands/${burgerBrand.id}/branches`]: () => json(page([])),
};

const asAdmin = { [REFRESH]: () => json(sessionFor(groupAdmin)), ...directory };

describe('the users list', () => {
  it('shows each person with role, sign-in, branch, status and last sign-in', async () => {
    mockApi({ ...asAdmin, [USERS]: () => json(page([sara, dana, lockedUser])) });
    renderApp('/admin/users');

    const row = (await screen.findByRole('link', { name: 'Sara Cashier' })).closest('tr');
    expect(row).not.toBeNull();
    const cells = within(row as HTMLElement);
    expect(cells.getByText('Cashier')).toBeInTheDocument();
    expect(cells.getByText('sara@pos.local')).toBeInTheDocument();
    expect(cells.getByText('1001')).toBeInTheDocument();
    expect(await cells.findByText('Pizza Palace - Mall Branch')).toBeInTheDocument();
    expect(cells.getByText('Active')).toBeInTheDocument();
    expect(cells.getByText(formatDateTime(sara.lastLoginAt ?? '', 'en'))).toBeInTheDocument();
  });

  it('shows inactive and locked people, and people who never signed in', async () => {
    mockApi({ ...asAdmin, [USERS]: () => json(page([sara, dana, lockedUser])) });
    renderApp('/admin/users');

    const danaRow = (await screen.findByRole('link', { name: 'Dana Downtown' })).closest('tr');
    expect(within(danaRow as HTMLElement).getByText('Inactive')).toBeInTheDocument();
    expect(within(danaRow as HTMLElement).getByText('Never')).toBeInTheDocument();

    const larryRow = screen.getByRole('link', { name: 'Locked Larry' }).closest('tr');
    const badge = within(larryRow as HTMLElement).getByText('Locked');
    expect(badge).toHaveAttribute(
      'title',
      `Locked until ${formatDateTime(lockedUser.lockedUntil ?? '', 'en')}`,
    );
  });

  it('shows a dash for people without branches', async () => {
    mockApi({
      ...asAdmin,
      [USERS]: () =>
        json(page([{ ...sara, branchIds: [], role: { ...sara.role, scope: 'BRAND' } }])),
    });
    renderApp('/admin/users');

    const row = (await screen.findByRole('link', { name: 'Sara Cashier' })).closest('tr');
    expect(within(row as HTMLElement).getByText('—')).toBeInTheDocument();
  });

  it('says so when nobody matches', async () => {
    mockApi({ ...asAdmin, [USERS]: () => json(page([])) });
    renderApp('/admin/users');

    expect(await screen.findByText('No users match these filters.')).toBeInTheDocument();
  });

  it('says so when the list cannot be loaded', async () => {
    mockApi({ ...asAdmin, [USERS]: () => errorResponse(500, 'INTERNAL_ERROR') });
    renderApp('/admin/users');

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the data.');
  });
});

describe('filters on the users list', () => {
  function openList() {
    return mockApi({ ...asAdmin, [USERS]: () => json(page([sara])) });
  }
  const lastQuery = (api: ReturnType<typeof openList>) =>
    api.calls.filter((call) => call.key === USERS).at(-1)?.url.searchParams;

  it('asks for a role and a status', async () => {
    const user = userEvent.setup();
    const api = openList();
    renderApp('/admin/users');
    await screen.findByRole('link', { name: 'Sara Cashier' });

    await user.selectOptions(screen.getByLabelText('Role'), 'cashier');
    await user.selectOptions(screen.getByLabelText('Status'), 'locked');

    await waitFor(() => {
      expect(lastQuery(api)?.get('role')).toBe('cashier');
      expect(lastQuery(api)?.get('status')).toBe('locked');
    });
  });

  it('searches by what is typed, without leading or trailing spaces', async () => {
    const user = userEvent.setup();
    const api = openList();
    renderApp('/admin/users');
    await screen.findByRole('link', { name: 'Sara Cashier' });

    await user.type(screen.getByLabelText('Search'), '  sara ');

    await waitFor(() => expect(lastQuery(api)?.get('q')).toBe('sara'));
  });

  it('asks for no filters at the start, and leaves empty ones out', async () => {
    const api = openList();
    renderApp('/admin/users');
    await screen.findByRole('link', { name: 'Sara Cashier' });

    const query = lastQuery(api);
    expect(query?.get('role')).toBeNull();
    expect(query?.get('status')).toBeNull();
    expect(query?.get('q')).toBeNull();
    expect(query?.get('limit')).toBe('25');
  });

  it('lists the roles by name, in the current language', async () => {
    openList();
    renderApp('/admin/users');
    await screen.findByRole('link', { name: 'Sara Cashier' });

    const options = within(screen.getByLabelText('Role')).getAllByRole('option');

    expect(options.map((option) => option.textContent)).toEqual([
      'All',
      'Group Admin',
      'Brand Manager',
      'Marketing',
      'Branch Manager',
      'Cashier',
      'Kitchen',
      'Purchaser',
    ]);
  });
});

describe('more people than fit on a page', () => {
  it('loads the next page when asked, and keeps the first', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...asAdmin,
      [USERS]: ({ url }) =>
        url.searchParams.get('cursor') ? json(page([dana])) : json(page([sara], sara.id)),
    });
    renderApp('/admin/users');
    await screen.findByRole('link', { name: 'Sara Cashier' });

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByRole('link', { name: 'Dana Downtown' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sara Cashier' })).toBeInTheDocument();
    const calls = api.calls.filter((call) => call.key === USERS);
    expect(calls[1]?.url.searchParams.get('cursor')).toBe(sara.id);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });
});

describe('what each role can do on the users list', () => {
  it('lets a person who can change users open somebody, and start a new person', async () => {
    mockApi({ ...asAdmin, [USERS]: () => json(page([sara])) });
    renderApp('/admin/users');

    const name = await screen.findByRole('link', { name: 'Sara Cashier' });
    expect(name).toHaveAttribute('href', `/admin/users/${sara.id}`);
    expect(screen.getByRole('link', { name: 'New user' })).toHaveAttribute(
      'href',
      '/admin/users/new',
    );
  });

  it('shows a branch manager the list without links to edit or create', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(branchManager)),
      [`GET /api/v1/brands/${pizzaBrand.id}/branches`]: () => json(page([pizzaMall])),
      [USERS]: () => json(page([sara, mahaManager])),
    });
    renderApp('/admin/users');

    expect(await screen.findByText('Maha Mall Manager')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Maha Mall Manager' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New user' })).not.toBeInTheDocument();
  });

  it('tells a cashier they may not open the page, and asks the server for nothing', async () => {
    const api = mockApi({ [REFRESH]: () => json(sessionFor(cashier)) });
    renderApp('/admin/users');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to open this page.',
    );
    expect(api.calls.filter((call) => call.key !== REFRESH)).toHaveLength(0);
  });

  it('sends a brand manager to the same list, with no group admin to see', async () => {
    mockApi({
      [REFRESH]: () =>
        json(
          sessionFor({
            ...brandManager,
            permissions: ['users:read', 'brands:read', 'branches:read'],
          }),
        ),
      'GET /api/v1/brands': () => json(page([pizzaBrand])),
      [`GET /api/v1/brands/${pizzaBrand.id}/branches`]: () => json(page([pizzaMall])),
      [USERS]: () => json(page([sara])),
    });
    renderApp('/admin/users');

    expect(await screen.findByText('Sara Cashier')).toBeInTheDocument();
  });
});

describe('the users list in Arabic', () => {
  it('shows the roles, statuses and headings in Arabic, and mirrors the layout', async () => {
    const user = userEvent.setup();
    mockApi({ ...asAdmin, [USERS]: () => json(page([sara, dana])) });
    renderApp('/admin/users');
    await screen.findByRole('link', { name: 'Sara Cashier' });

    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    expect(await screen.findByRole('heading', { name: 'المستخدمون' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'الاسم' })).toBeInTheDocument();
    const sarasRow = screen.getByRole('link', { name: 'Sara Cashier' }).closest('tr');
    expect(within(sarasRow as HTMLElement).getByText('أمين الصندوق')).toBeInTheDocument();
    expect(within(sarasRow as HTMLElement).getByText('نشط')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('غير نشط')).toBeInTheDocument();
    expect(screen.getByText('لم يسجّل الدخول')).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('writes the last sign-in with Western digits in Arabic', async () => {
    const user = userEvent.setup();
    mockApi({ ...asAdmin, [USERS]: () => json(page([sara])) });
    renderApp('/admin/users');
    await screen.findByRole('link', { name: 'Sara Cashier' });

    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    const expected = formatDateTime(sara.lastLoginAt ?? '', 'ar');
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(expected).toMatch(/2026/);
  });
});

describe('the notice after creating somebody', () => {
  it('is shown once, when the form sends the person back to the list', async () => {
    mockApi({ ...asAdmin, [USERS]: () => json(page([sara])) });
    renderApp({ pathname: '/admin/users', state: { notice: 'created' } });

    expect(await screen.findByRole('status')).toHaveTextContent('User created.');
  });

  it('is not shown on a plain visit', async () => {
    mockApi({ ...asAdmin, [USERS]: () => json(page([sara])) });
    renderApp('/admin/users');
    await screen.findByRole('link', { name: 'Sara Cashier' });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('the main menu', () => {
  it('shows the users link only to people who may read users', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(cashier)),
      [`GET /api/v1/brands/${pizzaBrand.id}/branches`]: () => json(page([])),
    });
    renderApp('/admin');

    await screen.findByText('Welcome, Mall Branch Cashier');

    const menu = within(screen.getByRole('navigation', { name: 'Main menu' }));
    expect(menu.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(menu.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(menu.queryByRole('link', { name: 'Roles' })).not.toBeInTheDocument();
    expect(menu.queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
  });

  it('shows every area to a group admin, and marks the current one', async () => {
    mockApi({ ...asAdmin, [USERS]: () => json(page([sara])) });
    renderApp('/admin/users');
    await screen.findByRole('link', { name: 'Sara Cashier' });

    const menu = within(screen.getByRole('navigation', { name: 'Main menu' }));
    expect(menu.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Dashboard',
      'Brands',
      'Branches',
      'Menu',
      'POS terminal',
      'Users',
      'Roles',
      'Audit log',
    ]);
    expect(menu.getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
    expect(menu.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('shows a branch manager the users area but not roles or the audit log', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(branchManager)),
      [`GET /api/v1/brands/${pizzaBrand.id}/branches`]: () => json(page([pizzaMall])),
    });
    renderApp('/admin');
    await screen.findByText('Welcome, Mall Branch Manager');

    const menu = within(screen.getByRole('navigation', { name: 'Main menu' }));
    expect(menu.getByRole('link', { name: 'Users' })).toBeInTheDocument();
    expect(menu.queryByRole('link', { name: 'Roles' })).not.toBeInTheDocument();
    expect(menu.queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
  });
});
