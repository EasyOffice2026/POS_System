import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  branchDetail,
  branchManager,
  burgerBrand,
  fullBrandManager,
  groupAdmin,
  page,
  pizzaBrand,
  pizzaDowntown,
  pizzaMall,
  sessionFor,
} from '../../test/fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const REFRESH = 'POST /api/v1/auth/refresh';
const BRANDS = 'GET /api/v1/brands';
const branchesOf = (brandId: string) => `GET /api/v1/brands/${brandId}/branches`;
const one = (id: string) => `GET /api/v1/branches/${id}`;
const patch = (id: string) => `PATCH /api/v1/branches/${id}`;
const create = (brandId: string) => `POST /api/v1/brands/${brandId}/branches`;

const directory: Record<string, MockHandler> = {
  [BRANDS]: () => json(page([pizzaBrand, burgerBrand])),
  [branchesOf(pizzaBrand.id)]: () => json(page([pizzaMall, pizzaDowntown])),
  [branchesOf(burgerBrand.id)]: () => json(page([])),
};

const bodyOf = (api: ReturnType<typeof mockApi>, key: string) =>
  api.calls.find((call) => call.key === key)?.body;

function openBranch(
  branch = branchDetail(),
  extra: Record<string, MockHandler> = {},
  session = groupAdmin,
) {
  return mockApi({
    [REFRESH]: () => json(sessionFor(session)),
    [one(branch.id)]: () => json(branch),
    ...directory,
    ...extra,
  });
}

type User = ReturnType<typeof userEvent.setup>;

async function fillNames(
  user: User,
  en = 'Pizza Palace - Corniche',
  ar = 'بيتزا بالاس - الكورنيش',
) {
  await user.type(await screen.findByLabelText('Name (English)'), en);
  await user.type(screen.getByLabelText('Name (Arabic)'), ar);
}

describe('the details of a branch', () => {
  it('shows what is stored, with the brand and the state', async () => {
    openBranch(branchDetail({ address: 'Level 1, City Mall' }));
    renderApp(`/admin/branches/${pizzaMall.id}`);

    expect(
      await screen.findByRole('heading', { name: 'Pizza Palace - Mall Branch' }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText('Name (English)')).toHaveValue(
      'Pizza Palace - Mall Branch',
    );
    expect(screen.getByLabelText('Name (Arabic)')).toHaveValue('بيتزا بالاس - فرع المول');
    expect(screen.getByLabelText('Address')).toHaveValue('Level 1, City Mall');
    expect(screen.getByLabelText('Time zone')).toHaveValue('Asia/Riyadh');
    expect(await screen.findByText('Pizza Palace')).toBeInTheDocument();
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
  });

  it('has a tab for each part, and marks the one that is open', async () => {
    openBranch();
    renderApp(`/admin/branches/${pizzaMall.id}`);
    await screen.findByLabelText('Name (English)');

    const tabs = within(screen.getByRole('navigation', { name: 'Branch settings' }));
    expect(tabs.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Details',
      'Opening hours',
      'Printers',
    ]);
    expect(tabs.getByRole('link', { name: 'Details' })).toHaveAttribute('aria-current', 'page');
    expect(tabs.getByRole('link', { name: 'Printers' })).not.toHaveAttribute('aria-current');
  });

  it('lists the time zones by region, and keeps one the browser does not list', async () => {
    openBranch(branchDetail({ timezone: 'Zulu' }));
    renderApp(`/admin/branches/${pizzaMall.id}`);

    const select = await screen.findByLabelText('Time zone');

    expect(select).toHaveValue('Zulu');
    expect(within(select).getByRole('group', { name: 'Asia' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Asia/Dubai' })).toBeInTheDocument();
  });

  it('sends only what changed', async () => {
    const user = userEvent.setup();
    const api = openBranch(branchDetail(), {
      [patch(pizzaMall.id)]: () =>
        json(branchDetail({ address: 'King Fahd Road', timezone: 'Asia/Dubai' })),
    });
    renderApp(`/admin/branches/${pizzaMall.id}`);

    await user.type(await screen.findByLabelText('Address'), 'King Fahd Road');
    await user.selectOptions(screen.getByLabelText('Time zone'), 'Asia/Dubai');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    expect(bodyOf(api, patch(pizzaMall.id))).toEqual({
      address: 'King Fahd Road',
      timezone: 'Asia/Dubai',
    });
  });

  it('sends both names when one of them is changed', async () => {
    const user = userEvent.setup();
    const api = openBranch(branchDetail(), { [patch(pizzaMall.id)]: () => json(branchDetail()) });
    renderApp(`/admin/branches/${pizzaMall.id}`);

    await user.type(await screen.findByLabelText('Name (English)'), ' 2');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Changes saved.');
    expect(bodyOf(api, patch(pizzaMall.id))).toEqual({
      name: { en: 'Pizza Palace - Mall Branch 2', ar: 'بيتزا بالاس - فرع المول' },
    });
  });

  it('clears the address with null when the field is emptied', async () => {
    const user = userEvent.setup();
    const api = openBranch(branchDetail({ address: 'Somewhere' }), {
      [patch(pizzaMall.id)]: () => json(branchDetail()),
    });
    renderApp(`/admin/branches/${pizzaMall.id}`);

    await user.clear(await screen.findByLabelText('Address'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Changes saved.');
    expect(bodyOf(api, patch(pizzaMall.id))).toEqual({ address: null });
  });

  it('sends nothing, and still says it is saved, when nothing changed', async () => {
    const user = userEvent.setup();
    const api = openBranch();
    renderApp(`/admin/branches/${pizzaMall.id}`);
    await screen.findByLabelText('Name (English)');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    expect(api.count(patch(pizzaMall.id))).toBe(0);
  });

  it('refuses an emptied name before asking the server', async () => {
    const user = userEvent.setup();
    const api = openBranch();
    renderApp(`/admin/branches/${pizzaMall.id}`);

    await user.clear(await screen.findByLabelText('Name (Arabic)'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByLabelText('Name (Arabic)')).toHaveAccessibleDescription(
      'Enter the name in this language.',
    );
    expect(api.count(patch(pizzaMall.id))).toBe(0);
  });

  it('shows a problem the server finds on the field that has it', async () => {
    const user = userEvent.setup();
    openBranch(branchDetail(), {
      [patch(pizzaMall.id)]: () =>
        errorResponse(400, 'VALIDATION_ERROR', [{ path: 'timezone', message: 'TIMEZONE_INVALID' }]),
    });
    renderApp(`/admin/branches/${pizzaMall.id}`);

    await user.selectOptions(await screen.findByLabelText('Time zone'), 'Asia/Dubai');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Choose a real time zone, for example Asia/Riyadh.'),
    ).toBeInTheDocument();
  });

  it('goes back to the branches of its brand', async () => {
    openBranch();
    renderApp(`/admin/branches/${pizzaMall.id}`);
    await screen.findByLabelText('Name (English)');

    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      `/admin/branches?brandId=${pizzaBrand.id}`,
    );
  });

  it('says so when the branch cannot be loaded', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(groupAdmin)),
      [one(pizzaMall.id)]: () => errorResponse(404, 'NOT_FOUND'),
      ...directory,
    });
    renderApp(`/admin/branches/${pizzaMall.id}`);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the data.');
  });

  it('lets a brand manager change a branch of their brand', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(fullBrandManager)),
      [one(pizzaMall.id)]: () => json(branchDetail()),
      [BRANDS]: () => json(page([pizzaBrand])),
      [branchesOf(pizzaBrand.id)]: () => json(page([pizzaMall])),
    });
    renderApp(`/admin/branches/${pizzaMall.id}`);

    expect(await screen.findByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
  });
});

describe('the tabs of a branch', () => {
  it('opens the tab named in the address, and goes to another one with its link', async () => {
    const user = userEvent.setup();
    openBranch();
    const { router } = renderApp(`/admin/branches/${pizzaMall.id}?tab=hours`);

    expect(await screen.findByLabelText('Hours on Sunday')).toBeInTheDocument();
    const tabs = within(screen.getByRole('navigation', { name: 'Branch settings' }));
    expect(tabs.getByRole('link', { name: 'Opening hours' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await user.click(tabs.getByRole('link', { name: 'Printers' }));

    expect(await screen.findByText('This branch has no printers yet.')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?tab=printers');

    await user.click(tabs.getByRole('link', { name: 'Details' }));

    expect(await screen.findByLabelText('Name (English)')).toBeInTheDocument();
    expect(router.state.location.search).toBe('');
  });

  it('opens the details for a tab it does not know', async () => {
    openBranch();
    renderApp(`/admin/branches/${pizzaMall.id}?tab=billing`);

    expect(await screen.findByLabelText('Name (English)')).toBeInTheDocument();
  });

  it('does not add a step to the history when a tab is chosen, so Back leaves the branch', async () => {
    const user = userEvent.setup();
    openBranch();
    const { router } = renderApp(`/admin/branches/${pizzaMall.id}`);
    await screen.findByLabelText('Name (English)');
    const before = router.state.historyAction;

    await user.click(screen.getByRole('link', { name: 'Printers' }));

    expect(before).toBe('POP');
    expect(router.state.historyAction).toBe('REPLACE');
  });
});

describe('deactivating and activating a branch', () => {
  it('deactivates the branch, and then offers to activate it again', async () => {
    const user = userEvent.setup();
    const api = openBranch(branchDetail(), {
      [patch(pizzaMall.id)]: () => json(branchDetail({ isActive: false })),
    });
    renderApp(`/admin/branches/${pizzaMall.id}`);

    await user.click(await screen.findByRole('button', { name: 'Deactivate' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The branch is deactivated.');
    expect(bodyOf(api, patch(pizzaMall.id))).toEqual({ isActive: false });
    expect(await screen.findByRole('button', { name: 'Activate' })).toBeInTheDocument();
    expect(screen.getAllByText('Inactive').length).toBeGreaterThan(0);
  });

  it('activates a branch that was deactivated', async () => {
    const user = userEvent.setup();
    const api = openBranch(branchDetail({ isActive: false }), {
      [patch(pizzaMall.id)]: () => json(branchDetail({ isActive: true })),
    });
    renderApp(`/admin/branches/${pizzaMall.id}`);

    await user.click(await screen.findByRole('button', { name: 'Activate' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The branch is active again.');
    expect(bodyOf(api, patch(pizzaMall.id))).toEqual({ isActive: true });
  });

  it('says what deactivating does, in plain words', async () => {
    openBranch();
    renderApp(`/admin/branches/${pizzaMall.id}`);

    expect(
      await screen.findByText(/keeps its people and history.*sign in at its terminals with a PIN/),
    ).toBeInTheDocument();
  });

  it('says when the change is refused', async () => {
    const user = userEvent.setup();
    openBranch(branchDetail(), { [patch(pizzaMall.id)]: () => errorResponse(403, 'FORBIDDEN') });
    renderApp(`/admin/branches/${pizzaMall.id}`);

    await user.click(await screen.findByRole('button', { name: 'Deactivate' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('You are not allowed to do this.');
  });
});

describe('a branch seen by somebody who may not change it', () => {
  const asBranchManager = () =>
    mockApi({
      [REFRESH]: () => json(sessionFor(branchManager)),
      [one(pizzaMall.id)]: () => json(branchDetail()),
      [branchesOf(pizzaBrand.id)]: () => json(page([pizzaMall])),
    });

  it('shows the details, with nothing to change and no way to save', async () => {
    asBranchManager();
    renderApp(`/admin/branches/${pizzaMall.id}`);

    expect(await screen.findByLabelText('Name (English)')).toBeDisabled();
    expect(screen.getByLabelText('Name (Arabic)')).toBeDisabled();
    expect(screen.getByLabelText('Address')).toBeDisabled();
    expect(screen.getByLabelText('Time zone')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    expect(
      screen.getByText('You can see this branch but you cannot change it.'),
    ).toBeInTheDocument();
  });

  it('shows the opening hours and the printers, with nothing to change', async () => {
    asBranchManager();
    renderApp(`/admin/branches/${pizzaMall.id}?tab=hours`);

    expect(await screen.findByLabelText('Hours on Sunday')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy to all days' })).not.toBeInTheDocument();
  });
});

describe('creating a branch', () => {
  const created = branchDetail({
    id: '01990000-0000-7000-8000-000000000013',
    name: { en: 'Pizza Palace - Corniche', ar: 'بيتزا بالاس - الكورنيش' },
  });

  function createApi(handler: MockHandler = () => json(created, 201), session = groupAdmin) {
    return mockApi({
      [REFRESH]: () => json(sessionFor(session)),
      ...directory,
      [create(pizzaBrand.id)]: handler,
      [one(created.id)]: () => json(created),
    });
  }

  it('creates a branch in the brand named in the address, and opens its settings with a notice', async () => {
    const user = userEvent.setup();
    const api = createApi();
    renderApp(`/admin/branches/new?brandId=${pizzaBrand.id}`);
    await fillNames(user);

    expect(await screen.findByLabelText('Brand')).toHaveValue(pizzaBrand.id);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Branch created. Next, set its opening hours and printers.',
    );
    expect(bodyOf(api, create(pizzaBrand.id))).toEqual({
      name: { en: 'Pizza Palace - Corniche', ar: 'بيتزا بالاس - الكورنيش' },
      timezone: 'Asia/Kuwait',
      isActive: true,
    });
    expect(
      await screen.findByRole('heading', { name: 'Pizza Palace - Corniche' }),
    ).toBeInTheDocument();
  });

  it('sends the address and the time zone that were chosen', async () => {
    const user = userEvent.setup();
    const api = createApi();
    renderApp(`/admin/branches/new?brandId=${pizzaBrand.id}`);
    await fillNames(user);

    await user.type(screen.getByLabelText('Address'), 'Corniche Road');
    await user.selectOptions(screen.getByLabelText('Time zone'), 'Asia/Dubai');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('status');
    expect(bodyOf(api, create(pizzaBrand.id))).toMatchObject({
      address: 'Corniche Road',
      timezone: 'Asia/Dubai',
    });
  });

  it('makes a group admin choose the brand when the address does not name one', async () => {
    const user = userEvent.setup();
    const api = createApi();
    renderApp('/admin/branches/new');
    await fillNames(user);

    await user.click(await screen.findByRole('button', { name: 'Save' }));

    expect(screen.getByLabelText('Brand')).toHaveAccessibleDescription('Choose a brand.');
    expect(api.count(create(pizzaBrand.id))).toBe(0);

    await user.selectOptions(screen.getByLabelText('Brand'), 'Pizza Palace');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('status');
    expect(api.count(create(pizzaBrand.id))).toBe(1);
  });

  it('marks a brand that is not active in the choice', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(groupAdmin)),
      [BRANDS]: () => json(page([pizzaBrand, { ...burgerBrand, isActive: false }])),
      [branchesOf(pizzaBrand.id)]: () => json(page([])),
      [branchesOf(burgerBrand.id)]: () => json(page([])),
    });
    renderApp('/admin/branches/new');

    const select = await screen.findByLabelText('Brand');

    expect(
      within(select).getByRole('option', { name: 'Burger Hub (inactive)' }),
    ).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Pizza Palace' })).toBeInTheDocument();
  });

  it('gives a brand manager no brand to choose, and creates in their own brand', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      [REFRESH]: () => json(sessionFor(fullBrandManager)),
      [BRANDS]: () => json(page([pizzaBrand])),
      [branchesOf(pizzaBrand.id)]: () => json(page([pizzaMall])),
      [create(pizzaBrand.id)]: () => json(created, 201),
      [one(created.id)]: () => json(created),
    });
    renderApp('/admin/branches/new');
    await fillNames(user);

    expect(screen.queryByLabelText('Brand')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('status');
    expect(api.count(create(pizzaBrand.id))).toBe(1);
  });

  it('asks for both names before sending anything', async () => {
    const user = userEvent.setup();
    const api = createApi();
    renderApp(`/admin/branches/new?brandId=${pizzaBrand.id}`);
    await user.type(await screen.findByLabelText('Name (English)'), 'Pizza Palace - Corniche');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByLabelText('Name (Arabic)')).toHaveAttribute('aria-invalid', 'true');
    expect(api.count(create(pizzaBrand.id))).toBe(0);
  });

  it('can start the branch as inactive, to set it up before it opens', async () => {
    const user = userEvent.setup();
    const api = createApi();
    renderApp(`/admin/branches/new?brandId=${pizzaBrand.id}`);
    await fillNames(user);

    await user.click(screen.getByRole('checkbox', { name: 'Active' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('status');
    expect(bodyOf(api, create(pizzaBrand.id))).toMatchObject({ isActive: false });
  });

  it('shows a problem the server finds', async () => {
    const user = userEvent.setup();
    createApi(() =>
      errorResponse(400, 'VALIDATION_ERROR', [{ path: 'address', message: 'ADDRESS_TOO_LONG' }]),
    );
    renderApp(`/admin/branches/new?brandId=${pizzaBrand.id}`);
    await fillNames(user);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('An address can have at most 300 characters.'),
    ).toBeInTheDocument();
  });

  it('has a way back to the list of the brand', async () => {
    createApi();
    renderApp(`/admin/branches/new?brandId=${pizzaBrand.id}`);

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
        'href',
        `/admin/branches?brandId=${pizzaBrand.id}`,
      ),
    );
  });

  it('is only for people who may change branches', async () => {
    const api = mockApi({ [REFRESH]: () => json(sessionFor(branchManager)) });
    renderApp('/admin/branches/new');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to open this page.',
    );
    expect(api.count(BRANDS)).toBe(0);
  });
});
