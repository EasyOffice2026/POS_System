import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  branchManager,
  brandManager,
  burgerAirport,
  burgerBrand,
  cashier,
  groupAdmin,
  page,
  pizzaBrand,
  pizzaDowntown,
  pizzaMall,
  sessionFor,
} from '../../test/fixtures';
import { errorResponse, json, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const REFRESH = 'POST /api/v1/auth/refresh';

// The header loads the brand's look (colour and logo) on every page; this is not the page's data.
const headerLook = (key: string) => /^GET \/api\/v1\/brands\/[^/]+(\/settings)?$/.test(key);
const BRANDS = 'GET /api/v1/brands';
const ALERTS = 'GET /api/v1/inventory/alerts';
const branchesOf = (brandId: string) => `GET /api/v1/brands/${brandId}/branches`;

describe('dashboard for a group admin', () => {
  function openDashboard() {
    return mockApi({
      [REFRESH]: () => json(sessionFor(groupAdmin)),
      [ALERTS]: () => json({ data: [] }),
      [BRANDS]: () => json(page([pizzaBrand, burgerBrand])),
      [branchesOf(pizzaBrand.id)]: () => json(page([pizzaMall, pizzaDowntown])),
      [branchesOf(burgerBrand.id)]: () => json(page([burgerAirport])),
    });
  }

  it('lists every brand with its branches', async () => {
    openDashboard();
    renderApp('/admin');

    const pizza = await screen.findByRole('heading', { name: 'Pizza Palace - Branches' });
    const burger = await screen.findByRole('heading', { name: 'Burger Hub - Branches' });
    expect(pizza.closest('section')).toHaveTextContent('Pizza Palace - Mall Branch');
    expect(pizza.closest('section')).toHaveTextContent('Pizza Palace - Downtown Branch');
    expect(burger.closest('section')).toHaveTextContent('Burger Hub - Airport Branch');
  });

  it('marks a brand and a branch that are not active', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(groupAdmin)),
      [ALERTS]: () => json({ data: [] }),
      [BRANDS]: () => json(page([pizzaBrand, { ...burgerBrand, isActive: false }])),
      [branchesOf(pizzaBrand.id)]: () =>
        json(page([pizzaMall, { ...pizzaDowntown, isActive: false }])),
      [branchesOf(burgerBrand.id)]: () => json(page([burgerAirport])),
    });
    renderApp('/admin');

    expect(
      await screen.findByRole('heading', { name: 'Burger Hub - Branches (inactive)' }),
    ).toBeInTheDocument();
    const pizza = await screen.findByRole('heading', { name: 'Pizza Palace - Branches' });
    expect(pizza.closest('section')).toHaveTextContent('Pizza Palace - Downtown Branch(inactive)');
    expect(pizza.closest('section')).not.toHaveTextContent('Pizza Palace - Mall Branch(inactive)');
  });

  it('shows the person and their role in the header', async () => {
    openDashboard();
    renderApp('/admin');

    await screen.findByText('Welcome, Group Admin');

    expect(screen.getByText('Role: Group Admin')).toBeInTheDocument();
    // The person and their role sit at the foot of the sidebar.
    expect(screen.getByRole('complementary')).toHaveTextContent('Group Admin');
  });

  it('switches names, labels and direction to Arabic', async () => {
    const user = userEvent.setup();
    openDashboard();
    renderApp('/admin');
    await screen.findByRole('heading', { name: 'Pizza Palace - Branches' });

    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    expect(
      await screen.findByRole('heading', { name: 'بيتزا بالاس - الفروع' }),
    ).toBeInTheDocument();
    expect(screen.getByText('برجر هب - فرع المطار')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'لوحة التحكم' })).toBeInTheDocument();
    expect(screen.getByText('مرحباً، Group Admin')).toBeInTheDocument();
    expect(screen.getByText('الدور: مدير المجموعة')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تسجيل الخروج' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('shows a message when there are no brands', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(groupAdmin)),
      [ALERTS]: () => json({ data: [] }),
      [BRANDS]: () => json(page([])),
    });
    renderApp('/admin');

    expect(await screen.findByText('There are no brands to show.')).toBeInTheDocument();
  });

  it('shows a message for a brand without branches', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(groupAdmin)),
      [ALERTS]: () => json({ data: [] }),
      [BRANDS]: () => json(page([pizzaBrand])),
      [branchesOf(pizzaBrand.id)]: () => json(page([])),
    });
    renderApp('/admin');

    expect(await screen.findByText('This brand has no branches yet.')).toBeInTheDocument();
  });

  it('says so when the data cannot be loaded', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(groupAdmin)),
      [ALERTS]: () => json({ data: [] }),
      [BRANDS]: () => errorResponse(500, 'INTERNAL_ERROR'),
    });
    renderApp('/admin');

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the data.');
  });

  it('reads every page when there are more brands than fit in one', async () => {
    const api = mockApi({
      [REFRESH]: () => json(sessionFor(groupAdmin)),
      [ALERTS]: () => json({ data: [] }),
      [BRANDS]: ({ url }) =>
        url.searchParams.get('cursor')
          ? json(page([burgerBrand]))
          : json(page([pizzaBrand], pizzaBrand.id)),
      [branchesOf(pizzaBrand.id)]: () => json(page([])),
      [branchesOf(burgerBrand.id)]: () => json(page([])),
    });
    renderApp('/admin');

    await screen.findByRole('heading', { name: 'Burger Hub - Branches' });

    const calls = api.calls.filter((call) => call.key === BRANDS);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url.searchParams.get('cursor')).toBe(pizzaBrand.id);
  });

  it('refreshes an expired token and carries on', async () => {
    const api = mockApi({
      [REFRESH]: () => json(sessionFor(groupAdmin, 'second-token')),
      [ALERTS]: () => json({ data: [] }),
      [BRANDS]: ({ authorization }) =>
        authorization === 'Bearer second-token'
          ? json(page([pizzaBrand]))
          : errorResponse(401, 'TOKEN_EXPIRED'),
      [branchesOf(pizzaBrand.id)]: () => json(page([pizzaMall])),
    });
    renderApp('/admin');

    expect(await screen.findByText('Pizza Palace - Mall Branch')).toBeInTheDocument();
    expect(api.count(BRANDS)).toBeGreaterThanOrEqual(1);
  });
});

describe('dashboard for other roles', () => {
  it('shows a brand manager the brands the API returns for them', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(brandManager)),
      [BRANDS]: () => json(page([pizzaBrand])),
      [branchesOf(pizzaBrand.id)]: () => json(page([pizzaMall, pizzaDowntown])),
    });
    renderApp('/admin');

    await screen.findByRole('heading', { name: 'Pizza Palace - Branches' });

    expect(screen.queryByText(/Burger Hub/)).not.toBeInTheDocument();
    expect(screen.getByText('Role: Brand Manager')).toBeInTheDocument();
  });

  it('shows a branch manager the branches of their brand without asking for brands', async () => {
    const api = mockApi({
      [REFRESH]: () => json(sessionFor(branchManager)),
      [branchesOf(pizzaBrand.id)]: () => json(page([pizzaMall])),
    });
    renderApp('/admin');

    expect(await screen.findByText('Pizza Palace - Mall Branch')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Branches' })).toBeInTheDocument();
    expect(api.count(BRANDS)).toBe(0);
  });

  it('tells a cashier there is nothing here for their role, and asks for nothing', async () => {
    const api = mockApi({ [REFRESH]: () => json(sessionFor(cashier)) });
    renderApp('/admin');

    expect(await screen.findByText('Your role has no dashboard sections yet.')).toBeInTheDocument();
    expect(api.calls.filter((call) => call.key !== REFRESH && !headerLook(call.key))).toHaveLength(
      0,
    );
  });
});
