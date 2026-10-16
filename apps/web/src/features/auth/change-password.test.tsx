import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { burgerBrand, fullBrandManager, page, pizzaBrand, sessionFor } from '../../test/fixtures';
import { errorResponse, json, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const CHANGE = 'POST /api/v1/auth/password';
const firstTimer = { ...fullBrandManager, mustChangePassword: true };

function api(user = firstTimer, change = () => json(sessionFor(fullBrandManager))) {
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(user)),
    'GET /api/v1/brands': () => json(page([pizzaBrand, burgerBrand])),
    'GET /api/v1/inventory/alerts': () => json({ data: [] }),
    [CHANGE]: change,
  });
}

describe('a password given by a manager', () => {
  it('must be changed before anything else, then the page asked for opens', async () => {
    const calls = api();
    const user = userEvent.setup();
    renderApp('/admin/brands');

    expect(await screen.findByRole('heading', { name: 'Change your password' })).toBeVisible();
    expect(screen.getByText(/for the first sign-in only/)).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Main menu' })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Current password'), 'DevPassw0rd!');
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('New password again'), 'short');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByLabelText('New password')).toHaveAccessibleDescription(
      /At least 10 characters/,
    );
    expect(calls.count(CHANGE)).toBe(0);

    await user.clear(screen.getByLabelText('New password'));
    await user.type(screen.getByLabelText('New password'), 'My-own-password-1');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByLabelText('New password again')).toHaveAccessibleDescription(
      'The two new passwords are not the same.',
    );

    await user.clear(screen.getByLabelText('New password again'));
    await user.type(screen.getByLabelText('New password again'), 'My-own-password-1');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('heading', { name: 'Brands' })).toBeVisible();
    expect(calls.calls.find((call) => call.key === CHANGE)?.body).toEqual({
      currentPassword: 'DevPassw0rd!',
      newPassword: 'My-own-password-1',
    });
  });

  it('shows the server refusing the current password', async () => {
    api(firstTimer, () =>
      errorResponse(400, 'VALIDATION_ERROR', [
        { path: 'currentPassword', message: 'PASSWORD_WRONG' },
      ]),
    );
    const user = userEvent.setup();
    renderApp('/admin');

    await user.type(await screen.findByLabelText('Current password'), 'guess');
    await user.type(screen.getByLabelText('New password'), 'My-own-password-1');
    await user.type(screen.getByLabelText('New password again'), 'My-own-password-1');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Current password')).toHaveAccessibleDescription(
        'The current password is not right.',
      ),
    );
  });

  it('can be changed at any time from the header', async () => {
    api(fullBrandManager);
    const user = userEvent.setup();
    renderApp('/admin');

    await user.click(await screen.findByRole('link', { name: 'Change password' }));
    expect(await screen.findByRole('heading', { name: 'Change your password' })).toBeVisible();
    expect(screen.getByText('Choose a new password for your account.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });
});
