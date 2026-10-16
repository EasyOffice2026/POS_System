import { defaultBrandSettings } from '@pos/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  brandSettings,
  burgerBrand,
  fullBrandManager,
  groupAdmin,
  ids,
  page,
  pizzaBrand,
  pizzaMall,
  sessionFor,
} from '../../test/fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const REFRESH = 'POST /api/v1/auth/refresh';
const SETTINGS = `GET /api/v1/brands/${ids.pizza}/settings`;
const SAVE = `PUT /api/v1/brands/${ids.pizza}/settings`;
const stationId = '01990000-0000-7000-8000-00000000a001';

function settingsApi(handlers: Record<string, MockHandler> = {}, user = fullBrandManager) {
  return mockApi({
    [REFRESH]: () => json(sessionFor(user)),
    'GET /api/v1/brands': () => json(page([pizzaBrand, burgerBrand])),
    [`GET /api/v1/brands/${ids.pizza}/branches`]: () => json(page([pizzaMall])),
    [`GET /api/v1/brands/${ids.burger}/branches`]: () => json(page([])),
    [SETTINGS]: () => json(brandSettings()),
    ...handlers,
  });
}

const field = (id: string) => document.getElementById(id) as HTMLElement;

describe('the settings page', () => {
  it('shows the settings of the brand and saves a change', async () => {
    const api = settingsApi({
      [SAVE]: (request) =>
        json({
          ...(request.body as object),
          cashierDiscountLimit: '10.00',
          discountPresets: ['5.00', '10.00', '15.00', '20.00', '25.00', '50.00'],
          kitchenStations: [{ id: stationId, name: { en: 'Pizza', ar: 'بيتزا' } }],
        }),
    });
    const user = userEvent.setup();
    renderApp('/admin/settings');

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(await screen.findByLabelText('Key')).toHaveValue('knet');
    expect(screen.getByLabelText('Key')).toBeDisabled();
    expect(screen.getByLabelText('Discount buttons')).toHaveValue('5, 10, 15, 20, 25, 50');
    expect(screen.getByRole('radio', { name: /Never: the cashier voids/ })).toBeChecked();

    await user.clear(screen.getByLabelText('A cashier may give up to (%)'));
    await user.type(screen.getByLabelText('A cashier may give up to (%)'), '10');
    await user.click(
      screen.getByRole('radio', { name: 'Once the dish or the order was sent to the kitchen' }),
    );
    await user.click(screen.getByRole('button', { name: 'Add a station' }));
    await user.type(field('station-0-name-en'), 'Pizza');
    await user.type(field('station-0-name-ar'), 'بيتزا');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The settings were saved.');
    expect(api.calls.find((call) => call.key === SAVE)?.body).toEqual({
      ...defaultBrandSettings,
      cashierDiscountLimit: '10',
      voidNeedsManager: 'after_send',
      discountPresets: ['5', '10', '15', '20', '25', '50'],
      kitchenStations: [{ name: { en: 'Pizza', ar: 'بيتزا' } }],
    });
  });

  it('refuses a bad key, and a key used twice, before sending', async () => {
    const api = settingsApi({
      [SAVE]: () =>
        errorResponse(400, 'VALIDATION_ERROR', [
          { path: 'paymentMethods', message: 'PAYMENT_METHOD_KEY_TAKEN' },
        ]),
    });
    const user = userEvent.setup();
    renderApp('/admin/settings');

    await user.click(await screen.findByRole('button', { name: 'Add a way to pay' }));
    await user.type(field('method-1-key'), 'Cash');
    await user.type(field('method-1-name-en'), 'Cash');
    await user.type(field('method-1-name-ar'), 'نقد');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(
        'A key has only small letters, digits and underscores, and is not "cash".',
      ),
    ).toBeVisible();
    expect(api.count(SAVE)).toBe(0);

    await user.clear(field('method-1-key'));
    await user.type(field('method-1-key'), 'knet');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Two ways to pay have the same key.')).toBeVisible();
    expect(api.count(SAVE)).toBe(0);
  });

  it('switches loyalty points on with their rules, and refuses a bad rate first', async () => {
    const api = settingsApi({ [SAVE]: (request) => json(request.body) });
    const user = userEvent.setup();
    renderApp('/admin/settings');

    const section = within(await screen.findByRole('region', { name: 'Loyalty points' }));
    expect(
      section.getByRole('checkbox', { name: 'Customers earn and spend points' }),
    ).not.toBeChecked();
    expect(section.getByLabelText('Points per KWD')).toHaveValue('1');
    expect(section.getByLabelText('Value of a point (KWD)')).toHaveValue('0.075');
    expect(section.getByLabelText('Fewest points to spend')).toHaveValue('100');

    await user.click(section.getByRole('checkbox', { name: 'Customers earn and spend points' }));
    await user.clear(section.getByLabelText('Points per KWD'));
    await user.type(section.getByLabelText('Points per KWD'), '1.5');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(section.getByLabelText('Points per KWD')).toHaveAccessibleDescription(
      'Points earned for each dinar paid, rounded down. Type a whole number from 0 to 1000.',
    );
    expect(api.count(SAVE)).toBe(0);

    await user.clear(section.getByLabelText('Points per KWD'));
    await user.type(section.getByLabelText('Points per KWD'), '2');
    await user.clear(section.getByLabelText('Value of a point (KWD)'));
    await user.type(section.getByLabelText('Value of a point (KWD)'), '0.005');
    await user.clear(section.getByLabelText('Fewest points to spend'));
    await user.type(section.getByLabelText('Fewest points to spend'), '٥٠');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The settings were saved.');
    expect(
      (api.calls.find((call) => call.key === SAVE)?.body as { loyalty: unknown }).loyalty,
    ).toEqual({
      enabled: true,
      pointsPerKwd: 2,
      pointValue: '0.005',
      minRedeem: 50,
    });
  });

  it('lets a group admin pick the brand', async () => {
    const api = settingsApi(
      {
        [`GET /api/v1/brands/${ids.burger}/settings`]: () =>
          json(brandSettings({ discountPresets: ['10.00'] })),
      },
      groupAdmin,
    );
    const user = userEvent.setup();
    renderApp('/admin/settings');

    await screen.findByLabelText('Discount buttons');
    await user.selectOptions(screen.getByLabelText('Brand'), ids.burger);
    expect(await screen.findByDisplayValue('10')).toBeVisible();
    expect(api.count(`GET /api/v1/brands/${ids.burger}/settings`)).toBe(1);
  });

  it('is not offered to a person without the right', async () => {
    settingsApi({}, { ...fullBrandManager, permissions: ['brands:read', 'branches:read'] });
    renderApp('/admin/settings');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to open this page.',
    );
    const nav = within(screen.getByRole('navigation', { name: 'Main menu' }));
    expect(nav.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });
});
