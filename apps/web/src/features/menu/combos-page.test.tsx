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
import { lunchDeal, pizzaMeal } from '../../test/menu-fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const REFRESH = 'POST /api/v1/auth/refresh';
const BRANDS = 'GET /api/v1/brands';
const BRANCHES = `GET /api/v1/brands/${ids.pizza}/branches`;
const COMBOS = 'GET /api/v1/menu/combos';

function api(
  combos: MockHandler = () => json({ data: [pizzaMeal, lunchDeal] }),
  user = fullBrandManager,
) {
  return mockApi({
    [REFRESH]: () => json(sessionFor(user)),
    [BRANDS]: () => json(page([pizzaBrand])),
    [BRANCHES]: () => json(page([pizzaMall])),
    [COMBOS]: combos,
  });
}

describe('the combos of the menu', () => {
  it('lists each combo with its name in both languages, its price, its choices and its status', async () => {
    const mock = api();
    renderApp('/admin/menu/combos');

    const row = (await screen.findByRole('link', { name: 'Pizza meal' })).closest(
      'tr',
    ) as HTMLElement;

    expect(within(row).getByText('وجبة بيتزا')).toHaveAttribute('lang', 'ar');
    expect(within(row).getByText('39.000')).toBeInTheDocument();
    expect(within(row).getByText('Pizza · Drink')).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();
    const other = screen.getByRole('link', { name: 'Lunch deal' }).closest('tr') as HTMLElement;
    expect(within(other).getByText('Inactive')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Combos' })).toHaveAttribute('aria-current', 'page');
    expect(mock.calls.find((call) => call.key === COMBOS)?.url.searchParams.get('brandId')).toBe(
      ids.pizza,
    );
  });

  it('links each combo to its builder', async () => {
    api();
    renderApp('/admin/menu/combos');

    expect(await screen.findByRole('link', { name: 'Lunch deal' })).toHaveAttribute(
      'href',
      `/admin/menu/combos/${lunchDeal.id}`,
    );
  });

  it('filters the combos by status', async () => {
    const user = userEvent.setup();
    api();
    renderApp('/admin/menu/combos');
    await screen.findByRole('link', { name: 'Pizza meal' });

    await user.selectOptions(screen.getByLabelText('Status'), 'inactive');

    expect(screen.queryByRole('link', { name: 'Pizza meal' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lunch deal' })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Status'), 'active');

    expect(screen.getByRole('link', { name: 'Pizza meal' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Lunch deal' })).not.toBeInTheDocument();
  });

  it('says so when there are no combos, and when the filter matches none', async () => {
    const user = userEvent.setup();
    api(() => json({ data: [pizzaMeal] }));
    renderApp('/admin/menu/combos');
    await screen.findByRole('link', { name: 'Pizza meal' });

    await user.selectOptions(screen.getByLabelText('Status'), 'inactive');

    expect(screen.getByText('No combo matches this filter.')).toBeInTheDocument();
  });

  it('says so when the brand has no combos', async () => {
    api(() => json({ data: [] }));
    renderApp('/admin/menu/combos');

    expect(await screen.findByText('There are no combos yet.')).toBeInTheDocument();
  });

  it('says so when the combos cannot be loaded', async () => {
    api(() => errorResponse(500, 'INTERNAL_ERROR'));
    renderApp('/admin/menu/combos');

    expect(await screen.findByText('Could not load the data.')).toBeInTheDocument();
  });

  it('offers a new combo to a person who may change the menu, in the brand that is open', async () => {
    api();
    renderApp('/admin/menu/combos');

    expect(await screen.findByRole('link', { name: 'New combo' })).toHaveAttribute(
      'href',
      `/admin/menu/combos/new?brandId=${ids.pizza}`,
    );
  });

  it('shows a person who may not change the menu the list without a new combo', async () => {
    api(undefined, { ...brandManager });
    renderApp('/admin/menu/combos');

    await screen.findByRole('link', { name: 'Pizza meal' });

    expect(screen.queryByRole('link', { name: 'New combo' })).not.toBeInTheDocument();
  });

  it('shows the names in Arabic first', async () => {
    await i18n.changeLanguage('ar');
    api();
    renderApp('/admin/menu/combos');

    const row = (await screen.findByRole('link', { name: 'وجبة بيتزا' })).closest(
      'tr',
    ) as HTMLElement;

    expect(within(row).getByText('Pizza meal')).toHaveAttribute('lang', 'en');
    expect(within(row).getByText('بيتزا · مشروب')).toBeInTheDocument();
  });
});
