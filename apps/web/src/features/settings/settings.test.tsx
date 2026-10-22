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
  branchDetail,
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
    await user.click(screen.getByRole('radio', { name: /When the kitchen starts the ticket/ }));
    await user.click(screen.getByRole('button', { name: 'Add a station' }));
    await user.type(field('station-0-name-en'), 'Pizza');
    await user.type(field('station-0-name-ar'), 'بيتزا');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The settings were saved.');
    expect(api.calls.find((call) => call.key === SAVE)?.body).toEqual({
      ...defaultBrandSettings,
      cashierDiscountLimit: '10',
      voidNeedsManager: 'after_send',
      stockDeductAt: 'preparing',
      discountPresets: ['5', '10', '15', '20', '25', '50'],
      kitchenStations: [{ name: { en: 'Pizza', ar: 'بيتزا' } }],
    });
  });

  it('switches the kitchen screen off at a branch, and the slip then always prints (spec 027)', async () => {
    const api = settingsApi({
      [`GET /api/v1/branches/${pizzaMall.id}`]: () => json(branchDetail()),
      [`PATCH /api/v1/branches/${pizzaMall.id}`]: (request) =>
        json(
          branchDetail({
            config: { ...branchDetail().config, ...(request.body as { config: object }).config },
          }),
        ),
    });
    const user = userEvent.setup();
    renderApp('/admin/settings');

    const screenBox = await screen.findByLabelText('Kitchen screen at Pizza Palace - Mall Branch');
    expect(screenBox).toBeChecked();
    const slipBox = screen.getByLabelText('Kitchen slip at Pizza Palace - Mall Branch');
    expect(slipBox).not.toBeChecked();

    await user.click(screenBox);
    expect(slipBox).toBeChecked();
    expect(slipBox).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save the kitchen settings' }));

    expect(await screen.findByText(/The kitchen settings were saved/)).toBeVisible();
    expect(
      api.calls.find((call) => call.key === `PATCH /api/v1/branches/${pizzaMall.id}`)?.body,
    ).toEqual({ config: { kitchen: { screen: false, slip: false, lateAfterMinutes: 12 } } });
  });

  it('saves the brand colour, and refuses one that is not a colour', async () => {
    const api = settingsApi({ [SAVE]: (request) => json(request.body) });
    const user = userEvent.setup();
    renderApp('/admin/settings');

    const colour = await screen.findByLabelText('Colour');
    expect(colour).toHaveValue('');
    await user.type(colour, 'red');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(colour).toHaveAccessibleDescription(/six letters or digits/);
    expect(api.count(SAVE)).toBe(0);

    await user.clear(colour);
    await user.type(colour, '#b00020');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('The settings were saved.');
    expect(
      (api.calls.find((call) => call.key === SAVE)?.body as typeof defaultBrandSettings).appearance,
    ).toEqual({ color: '#b00020' });
  });

  it('adds a delivery platform with its commission rate (spec 025)', async () => {
    const api = settingsApi({ [SAVE]: (request) => json(request.body) });
    const user = userEvent.setup();
    renderApp('/admin/settings');

    expect(await screen.findByLabelText('Commission (%)')).toHaveValue('0.00');
    await user.click(screen.getByRole('button', { name: 'Add a way to pay' }));
    await user.type(field('method-1-key'), 'talabat');
    await user.type(field('method-1-name-en'), 'Talabat');
    await user.type(field('method-1-name-ar'), 'طلبات');
    await user.clear(field('method-1-commission'));
    await user.type(field('method-1-commission'), '18.5');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The settings were saved.');
    expect(
      (api.calls.find((call) => call.key === SAVE)?.body as typeof defaultBrandSettings)
        .paymentMethods,
    ).toEqual([
      { key: 'knet', name: { en: 'KNET', ar: 'كي نت' }, isActive: true, commissionRate: '0.00' },
      {
        key: 'talabat',
        name: { en: 'Talabat', ar: 'طلبات' },
        isActive: true,
        commissionRate: '18.5',
      },
    ]);
  });

  it('shows a commission rate the server refuses next to its field', async () => {
    settingsApi({
      [SAVE]: () =>
        errorResponse(400, 'VALIDATION_ERROR', [
          { path: 'paymentMethods.0.commissionRate', message: 'COMMISSION_RATE_INVALID' },
        ]),
    });
    const user = userEvent.setup();
    renderApp('/admin/settings');

    await user.clear(await screen.findByLabelText('Commission (%)'));
    await user.type(screen.getByLabelText('Commission (%)'), '150');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByLabelText('Commission (%)')).toHaveAccessibleDescription(/0 to 100/);
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
