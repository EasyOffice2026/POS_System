import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  branchManager,
  burgerAirport,
  burgerBrand,
  cashier,
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

const directory: Record<string, MockHandler> = {
  [BRANDS]: () => json(page([pizzaBrand, burgerBrand])),
  [branchesOf(pizzaBrand.id)]: () => json(page([pizzaMall, pizzaDowntown])),
  [branchesOf(burgerBrand.id)]: () => json(page([burgerAirport])),
};

const asAdmin = { [REFRESH]: () => json(sessionFor(groupAdmin)), ...directory };

const asBrandManager = {
  [REFRESH]: () => json(sessionFor(fullBrandManager)),
  [BRANDS]: () => json(page([pizzaBrand])),
  [branchesOf(pizzaBrand.id)]: () => json(page([pizzaMall, pizzaDowntown])),
};

describe('the branches list', () => {
  it('shows every branch of every brand to a group admin, with its brand', async () => {
    mockApi(asAdmin);
    renderApp('/admin/branches');

    const mall = (await screen.findByRole('link', { name: 'Pizza Palace - Mall Branch' })).closest(
      'tr',
    );
    expect(await within(mall as HTMLElement).findByText('Pizza Palace')).toBeInTheDocument();
    expect(within(mall as HTMLElement).getByText('Asia/Riyadh')).toBeInTheDocument();
    expect(within(mall as HTMLElement).getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Burger Hub - Airport Branch' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('shows the name in the other language under the name, and the address', async () => {
    mockApi({
      ...asAdmin,
      [branchesOf(pizzaBrand.id)]: () =>
        json(page([{ ...pizzaMall, address: 'Level 1, City Mall' }, pizzaDowntown])),
    });
    renderApp('/admin/branches');

    const mall = (await screen.findByRole('link', { name: 'Pizza Palace - Mall Branch' })).closest(
      'tr',
    );
    expect(within(mall as HTMLElement).getByText('بيتزا بالاس - فرع المول')).toHaveAttribute(
      'lang',
      'ar',
    );
    expect(within(mall as HTMLElement).getByText('Level 1, City Mall')).toBeInTheDocument();
  });

  it('links each branch to its settings', async () => {
    mockApi(asAdmin);
    renderApp('/admin/branches');

    expect(await screen.findByRole('link', { name: 'Pizza Palace - Mall Branch' })).toHaveAttribute(
      'href',
      `/admin/branches/${pizzaMall.id}`,
    );
  });

  it('marks a branch that is not active', async () => {
    mockApi({
      ...asAdmin,
      [branchesOf(pizzaBrand.id)]: () =>
        json(page([pizzaMall, { ...pizzaDowntown, isActive: false }])),
    });
    renderApp('/admin/branches');

    const row = (
      await screen.findByRole('link', { name: 'Pizza Palace - Downtown Branch' })
    ).closest('tr');
    expect(within(row as HTMLElement).getByText('Inactive')).toBeInTheDocument();
  });

  it('shows the branches of one brand when the address names it, and the filter shows it', async () => {
    mockApi(asAdmin);
    renderApp(`/admin/branches?brandId=${burgerBrand.id}`);

    expect(
      await screen.findByRole('link', { name: 'Burger Hub - Airport Branch' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Pizza Palace - Mall Branch' }),
    ).not.toBeInTheDocument();
    expect(await screen.findByLabelText('Brand')).toHaveValue(burgerBrand.id);
  });

  it('marks a brand that is not active in the filter', async () => {
    mockApi({
      ...asAdmin,
      [BRANDS]: () => json(page([pizzaBrand, { ...burgerBrand, isActive: false }])),
    });
    renderApp('/admin/branches');

    const filter = await screen.findByLabelText('Brand');

    expect(
      within(filter).getByRole('option', { name: 'Burger Hub (inactive)' }),
    ).toBeInTheDocument();
    expect(within(filter).getByRole('option', { name: 'Pizza Palace' })).toBeInTheDocument();
  });

  it('filters by brand, and puts the brand in the address', async () => {
    const user = userEvent.setup();
    mockApi(asAdmin);
    const { router } = renderApp('/admin/branches');
    await screen.findByRole('link', { name: 'Pizza Palace - Mall Branch' });

    await user.selectOptions(await screen.findByLabelText('Brand'), 'Burger Hub');

    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: 'Pizza Palace - Mall Branch' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'Burger Hub - Airport Branch' })).toBeInTheDocument();
    expect(router.state.location.search).toBe(`?brandId=${burgerBrand.id}`);

    await user.selectOptions(screen.getByLabelText('Brand'), 'All');

    expect(
      await screen.findByRole('link', { name: 'Pizza Palace - Mall Branch' }),
    ).toBeInTheDocument();
    expect(router.state.location.search).toBe('');
  });

  it('offers a new branch for the brand that is chosen, or for none yet', async () => {
    const user = userEvent.setup();
    mockApi(asAdmin);
    renderApp('/admin/branches');
    await screen.findByRole('link', { name: 'Pizza Palace - Mall Branch' });

    expect(screen.getByRole('link', { name: 'New branch' })).toHaveAttribute(
      'href',
      '/admin/branches/new',
    );

    await user.selectOptions(await screen.findByLabelText('Brand'), 'Pizza Palace');

    expect(screen.getByRole('link', { name: 'New branch' })).toHaveAttribute(
      'href',
      `/admin/branches/new?brandId=${pizzaBrand.id}`,
    );
  });

  it('shows a brand manager the branches of their brand, with no brand to choose', async () => {
    mockApi(asBrandManager);
    renderApp('/admin/branches');

    expect(
      await screen.findByRole('link', { name: 'Pizza Palace - Mall Branch' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Brand')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Brand' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New branch' })).toHaveAttribute(
      'href',
      `/admin/branches/new?brandId=${pizzaBrand.id}`,
    );
  });

  it('shows a branch manager their own branch, which they can open but not add to', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(branchManager)),
      [branchesOf(pizzaBrand.id)]: () => json(page([pizzaMall])),
    });
    renderApp('/admin/branches');

    expect(
      await screen.findByRole('link', { name: 'Pizza Palace - Mall Branch' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New branch' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Brand' })).not.toBeInTheDocument();
  });

  it('says so when there are no branches', async () => {
    mockApi({
      ...asAdmin,
      [branchesOf(pizzaBrand.id)]: () => json(page([])),
      [branchesOf(burgerBrand.id)]: () => json(page([])),
    });
    renderApp('/admin/branches');

    expect(await screen.findByText('There are no branches to show.')).toBeInTheDocument();
  });

  it('says so when the branches cannot be loaded', async () => {
    mockApi({
      ...asAdmin,
      [branchesOf(pizzaBrand.id)]: () => errorResponse(500, 'INTERNAL_ERROR'),
    });
    renderApp('/admin/branches');

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the data.');
  });

  it('is written in Arabic, with the English name under the Arabic one and the zone left to right', async () => {
    const user = userEvent.setup();
    mockApi(asAdmin);
    renderApp('/admin/branches');
    await screen.findByRole('link', { name: 'Pizza Palace - Mall Branch' });

    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    expect(await screen.findByRole('heading', { name: 'الفروع' })).toBeInTheDocument();
    const row = screen.getByRole('link', { name: 'بيتزا بالاس - فرع المول' }).closest('tr');
    expect(within(row as HTMLElement).getByText('Pizza Palace - Mall Branch')).toHaveAttribute(
      'lang',
      'en',
    );
    expect(within(row as HTMLElement).getByText('Asia/Riyadh')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('link', { name: 'فرع جديد' })).toBeInTheDocument();
  });
});

describe('who may open the branches list', () => {
  it('tells a cashier they may not, and asks the server for nothing', async () => {
    const api = mockApi({ [REFRESH]: () => json(sessionFor(cashier)) });
    renderApp('/admin/branches');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to open this page.',
    );
    expect(api.count(BRANDS)).toBe(0);
  });
});
