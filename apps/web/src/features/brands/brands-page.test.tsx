import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  brandManager,
  burgerBrand,
  cashier,
  groupAdmin,
  page,
  pizzaBrand,
  sessionFor,
} from '../../test/fixtures';
import { errorResponse, json, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const REFRESH = 'POST /api/v1/auth/refresh';
const BRANDS = 'GET /api/v1/brands';

const asAdmin = { [REFRESH]: () => json(sessionFor(groupAdmin)) };

describe('the brands list', () => {
  it('shows each brand with its name, the other language under it, and its state', async () => {
    mockApi({
      ...asAdmin,
      [BRANDS]: () => json(page([pizzaBrand, { ...burgerBrand, isActive: false }])),
    });
    renderApp('/admin/brands');

    const pizza = (await screen.findByRole('link', { name: 'Pizza Palace' })).closest('tr');
    expect(within(pizza as HTMLElement).getByText('بيتزا بالاس')).toBeInTheDocument();
    expect(within(pizza as HTMLElement).getByText('Active')).toBeInTheDocument();

    const burger = screen.getByRole('link', { name: 'Burger Hub' }).closest('tr');
    expect(within(burger as HTMLElement).getByText('برجر هب')).toBeInTheDocument();
    expect(within(burger as HTMLElement).getByText('Inactive')).toBeInTheDocument();
  });

  it('links each name to its form, each brand to its branches, and offers a new brand', async () => {
    mockApi({ ...asAdmin, [BRANDS]: () => json(page([pizzaBrand])) });
    renderApp('/admin/brands');

    const name = await screen.findByRole('link', { name: 'Pizza Palace' });
    expect(name).toHaveAttribute('href', `/admin/brands/${pizzaBrand.id}`);
    expect(screen.getByRole('link', { name: 'View branches' })).toHaveAttribute(
      'href',
      `/admin/branches?brandId=${pizzaBrand.id}`,
    );
    expect(screen.getByRole('link', { name: 'New brand' })).toHaveAttribute(
      'href',
      '/admin/brands/new',
    );
  });

  it('lets a brand manager see their brand but not change it', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(brandManager)),
      [BRANDS]: () => json(page([pizzaBrand])),
    });
    renderApp('/admin/brands');

    expect(await screen.findByText('Pizza Palace')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Pizza Palace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New brand' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View branches' })).toBeInTheDocument();
  });

  it('says so when a brand has just been created', async () => {
    mockApi({ ...asAdmin, [BRANDS]: () => json(page([pizzaBrand])) });
    renderApp({ pathname: '/admin/brands', state: { notice: 'created' } });

    expect(await screen.findByRole('status')).toHaveTextContent('Brand created.');
  });

  it('says so when there are no brands', async () => {
    mockApi({ ...asAdmin, [BRANDS]: () => json(page([])) });
    renderApp('/admin/brands');

    expect(await screen.findByText('There are no brands yet.')).toBeInTheDocument();
  });

  it('says so when the brands cannot be loaded', async () => {
    mockApi({ ...asAdmin, [BRANDS]: () => errorResponse(500, 'INTERNAL_ERROR') });
    renderApp('/admin/brands');

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the data.');
  });

  it('writes the names in Arabic, with the English name under them, when the language is switched', async () => {
    const user = userEvent.setup();
    mockApi({ ...asAdmin, [BRANDS]: () => json(page([pizzaBrand])) });
    renderApp('/admin/brands');
    await screen.findByRole('link', { name: 'Pizza Palace' });

    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    expect(await screen.findByRole('heading', { name: 'العلامات التجارية' })).toBeInTheDocument();
    const row = screen.getByRole('link', { name: 'بيتزا بالاس' }).closest('tr');
    expect(within(row as HTMLElement).getByText('Pizza Palace')).toHaveAttribute('lang', 'en');
    expect(within(row as HTMLElement).getByText('نشط')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'علامة تجارية جديدة' })).toBeInTheDocument();
  });
});

describe('who may open the brands list', () => {
  it('tells a cashier they may not, and asks the server for nothing', async () => {
    const api = mockApi({ [REFRESH]: () => json(sessionFor(cashier)) });
    renderApp('/admin/brands');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to open this page.',
    );
    expect(api.count(BRANDS)).toBe(0);
  });
});
