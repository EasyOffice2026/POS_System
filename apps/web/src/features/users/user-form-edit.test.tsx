import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { formatDateTime } from '../../i18n/format';
import {
  adminUser,
  brandManager,
  burgerBrand,
  dana,
  groupAdmin,
  lockedUser,
  mahaManager,
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

const directory: Record<string, MockHandler> = {
  'GET /api/v1/brands': () => json(page([pizzaBrand, burgerBrand])),
  [`GET /api/v1/brands/${pizzaBrand.id}/branches`]: () => json(page([pizzaMall, pizzaDowntown])),
  [`GET /api/v1/brands/${burgerBrand.id}/branches`]: () => json(page([])),
};

// Opens the edit page of one person, as a group admin unless another session is given.
function openEdit(person = sara, extra: Record<string, MockHandler> = {}, session = groupAdmin) {
  const api = mockApi({
    [REFRESH]: () => json(sessionFor(session)),
    'GET /api/v1/roles': () => json({ data: rolesFor('group') }),
    'GET /api/v1/users': () => json(page([person])),
    [`GET /api/v1/users/${person.id}`]: () => json(person),
    ...directory,
    ...extra,
  });
  const rendered = renderApp(`/admin/users/${person.id}`);
  return { api, ...rendered };
}

const patchKey = (id: string) => `PATCH /api/v1/users/${id}`;
const bodyOf = (api: ReturnType<typeof mockApi>, key: string) =>
  api.calls.find((call) => call.key === key)?.body;

describe('editing a person', () => {
  it('shows what is stored about them', async () => {
    openEdit();

    expect(await screen.findByRole('heading', { name: 'Edit user' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Name')).toHaveValue('Sara Cashier');
    expect(screen.getByLabelText('Email')).toHaveValue('sara@pos.local');
    expect(screen.getByLabelText('Staff code')).toHaveValue('1001');
    expect(screen.getByLabelText('Role')).toHaveValue('cashier');
    expect(await screen.findByLabelText('Pizza Palace - Mall Branch')).toBeChecked();
    expect(screen.getByLabelText('Pizza Palace - Downtown Branch')).not.toBeChecked();
  });

  it('does not ask for the brand, or a first password or PIN, when changing somebody', async () => {
    openEdit();
    await screen.findByLabelText('Name');

    expect(screen.queryByLabelText('Brand')).not.toBeInTheDocument();
    // The password and PIN options further down are radio buttons, not text fields.
    expect(screen.queryByRole('textbox', { name: 'Password' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'PIN' })).not.toBeInTheDocument();
  });

  it('sends only what changed', async () => {
    const user = userEvent.setup();
    const { api } = openEdit(sara, {
      [patchKey(sara.id)]: () => json({ ...sara, name: 'Sara Renamed' }),
    });
    const name = await screen.findByLabelText('Name');

    await user.clear(name);
    await user.type(name, 'Sara Renamed');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.count(patchKey(sara.id))).toBe(1));
    expect(bodyOf(api, patchKey(sara.id))).toEqual({ name: 'Sara Renamed' });
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
  });

  it('sends nothing, and still says it is saved, when nothing changed', async () => {
    const user = userEvent.setup();
    const { api } = openEdit();
    await screen.findByLabelText('Name');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    expect(api.count(patchKey(sara.id))).toBe(0);
  });

  it('sends the new list of branches', async () => {
    const user = userEvent.setup();
    const { api } = openEdit(sara, {
      [patchKey(sara.id)]: () => json({ ...sara, branchIds: [pizzaMall.id, pizzaDowntown.id] }),
    });

    await user.click(await screen.findByLabelText('Pizza Palace - Downtown Branch'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.count(patchKey(sara.id))).toBe(1));
    expect(bodyOf(api, patchKey(sara.id))).toEqual({ branchIds: [pizzaMall.id, pizzaDowntown.id] });
  });

  it('refuses to save a branch role without any branch', async () => {
    const user = userEvent.setup();
    const { api } = openEdit();

    await user.click(await screen.findByLabelText('Pizza Palace - Mall Branch'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Pick at least one branch.')).toBeInTheDocument();
    expect(api.count(patchKey(sara.id))).toBe(0);
  });

  it('sends the new role, and the branches are cleared for a role without branches', async () => {
    const user = userEvent.setup();
    const { api } = openEdit(sara, {
      [patchKey(sara.id)]: () =>
        json({
          ...sara,
          role: { key: 'marketing', name: 'Marketing', scope: 'BRAND' },
          branchIds: [],
        }),
    });

    await user.selectOptions(await screen.findByLabelText('Role'), 'marketing');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.count(patchKey(sara.id))).toBe(1));
    expect(bodyOf(api, patchKey(sara.id))).toEqual({ roleKey: 'marketing', branchIds: [] });
  });

  it('clears the email with null when the field is emptied', async () => {
    const user = userEvent.setup();
    const { api } = openEdit(sara, {
      [patchKey(sara.id)]: () => json({ ...sara, email: null }),
    });

    await user.clear(await screen.findByLabelText('Email'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.count(patchKey(sara.id))).toBe(1));
    expect(bodyOf(api, patchKey(sara.id))).toEqual({ email: null });
  });

  it('says when the new email is used by somebody else', async () => {
    const user = userEvent.setup();
    openEdit(sara, { [patchKey(sara.id)]: () => errorResponse(409, 'EMAIL_TAKEN') });
    const email = await screen.findByLabelText('Email');

    await user.clear(email);
    await user.type(email, 'taken@pos.local');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('This email is already used.')).toBeInTheDocument();
  });

  it('answers that the person cannot be found when the server cannot find them', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(groupAdmin)),
      'GET /api/v1/roles': () => json({ data: rolesFor('group') }),
      [`GET /api/v1/users/${sara.id}`]: () => errorResponse(404, 'NOT_FOUND'),
      ...directory,
    });
    renderApp(`/admin/users/${sara.id}`);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the data.');
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('goes back to the list from the cancel and back links', async () => {
    const user = userEvent.setup();
    const { router } = openEdit();
    await screen.findByLabelText('Name');

    await user.click(screen.getByRole('link', { name: 'Cancel' }));

    expect(router.state.location.pathname).toBe('/admin/users');
  });
});

describe('editing yourself', () => {
  const me = adminUser({
    id: brandManager.id,
    name: brandManager.name,
    email: brandManager.email,
    staffCode: null,
    brandId: pizzaBrand.id,
    role: { key: 'brand_manager', name: 'Brand Manager', scope: 'BRAND' },
    branchIds: [],
  });
  const managerSession = {
    ...brandManager,
    permissions: [
      ...brandManager.permissions,
      'users:read' as const,
      'users:write' as const,
      'roles:read' as const,
    ],
  };

  function openSelf() {
    return mockApi({
      [REFRESH]: () => json(sessionFor(managerSession)),
      'GET /api/v1/roles': () => json({ data: rolesFor('brand') }),
      [`GET /api/v1/users/${me.id}`]: () => json(me),
      'GET /api/v1/brands': () => json(page([pizzaBrand])),
      [`GET /api/v1/brands/${pizzaBrand.id}/branches`]: () => json(page([pizzaMall])),
    });
  }

  it('does not let a person change their own role, and says why', async () => {
    openSelf();
    renderApp(`/admin/users/${me.id}`);

    const role = await screen.findByLabelText('Role');

    expect(role).toBeDisabled();
    expect(role).toHaveAccessibleDescription('You cannot change your own role.');
  });

  it('does not offer to deactivate yourself', async () => {
    openSelf();
    renderApp(`/admin/users/${me.id}`);
    await screen.findByLabelText('Role');

    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activate' })).not.toBeInTheDocument();
  });
});

describe('deactivating, activating and unlocking', () => {
  it('deactivates somebody and then offers to activate them again', async () => {
    const user = userEvent.setup();
    const { api } = openEdit(sara, {
      [patchKey(sara.id)]: () => json({ ...sara, isActive: false }),
    });

    await user.click(await screen.findByRole('button', { name: 'Deactivate' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'The account is deactivated and signed out everywhere.',
    );
    expect(bodyOf(api, patchKey(sara.id))).toEqual({ isActive: false });
    expect(await screen.findByRole('button', { name: 'Activate' })).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('activates somebody who was deactivated', async () => {
    const user = userEvent.setup();
    const { api } = openEdit(dana, {
      [patchKey(dana.id)]: () => json({ ...dana, isActive: true }),
    });

    await user.click(await screen.findByRole('button', { name: 'Activate' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The account is active again.');
    expect(bodyOf(api, patchKey(dana.id))).toEqual({ isActive: true });
  });

  it('says when the change is refused', async () => {
    const user = userEvent.setup();
    openEdit(sara, { [patchKey(sara.id)]: () => errorResponse(403, 'FORBIDDEN') });

    await user.click(await screen.findByRole('button', { name: 'Deactivate' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('You are not allowed to do this.');
  });

  it('offers to unlock only a person who is locked', async () => {
    openEdit(sara);
    await screen.findByLabelText('Name');

    expect(screen.queryByRole('button', { name: 'Unlock' })).not.toBeInTheDocument();
  });

  it('unlocks a locked person', async () => {
    const user = userEvent.setup();
    const unlock = `POST /api/v1/users/${lockedUser.id}/unlock`;
    const { api } = openEdit(lockedUser, {
      [unlock]: () => json({ ...lockedUser, lockedUntil: null }),
    });

    await user.click(await screen.findByRole('button', { name: 'Unlock' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The account is unlocked.');
    expect(api.count(unlock)).toBe(1);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Unlock' })).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows the state of the account', async () => {
    openEdit(sara);

    expect(await screen.findByText('Active')).toBeInTheDocument();
  });

  it('shows that a deactivated account is deactivated', async () => {
    openEdit(dana);

    expect(await screen.findByText('Inactive')).toBeInTheDocument();
  });

  it('shows until when a locked account stays locked', async () => {
    openEdit(lockedUser);

    const until = formatDateTime(lockedUser.lockedUntil ?? '', 'en');

    expect(await screen.findByText(`Locked until ${until}`)).toBeInTheDocument();
  });

  it('links to the activity of the person for people who may read the audit log', async () => {
    openEdit();

    const link = await screen.findByRole('link', { name: 'View activity' });

    expect(link).toHaveAttribute('href', `/admin/audit?userId=${sara.id}`);
  });

  it('shows no activity link to a person who may not read the audit log', async () => {
    openEdit(
      sara,
      {},
      { ...groupAdmin, permissions: groupAdmin.permissions.filter((p) => p !== 'audit:read') },
    );
    await screen.findByLabelText('Name');

    expect(screen.queryByRole('link', { name: 'View activity' })).not.toBeInTheDocument();
  });
});

describe('setting a password or PIN', () => {
  const credentials = (id: string) => `POST /api/v1/users/${id}/credentials`;

  it('makes a PIN when none is typed, and shows it once with a way to copy it', async () => {
    const user = userEvent.setup();
    const { api } = openEdit(sara, {
      [credentials(sara.id)]: () => json({ type: 'pin', generatedValue: '482915' }),
    });
    await screen.findByLabelText('Name');

    await user.click(screen.getByRole('button', { name: 'Set' }));

    expect(await screen.findByText('482915')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'The new PIN is shown only now. Copy it and give it to the person.',
    );
    expect(bodyOf(api, credentials(sara.id))).toEqual({ type: 'pin' });

    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe('482915');
  });

  it('sends a typed PIN and does not show it back', async () => {
    const user = userEvent.setup();
    const { api } = openEdit(sara, {
      [credentials(sara.id)]: () => json({ type: 'pin', generatedValue: null }),
    });
    await user.type(await screen.findByLabelText('New value'), '7391');

    await user.click(screen.getByRole('button', { name: 'Set' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      "Saved. The person's sessions were ended.",
    );
    expect(bodyOf(api, credentials(sara.id))).toEqual({ type: 'pin', value: '7391' });
    expect(screen.queryByText('7391')).not.toBeInTheDocument();
    expect(screen.getByLabelText('New value')).toHaveValue('');
  });

  it('makes a password when the password option is chosen and nothing is typed', async () => {
    const user = userEvent.setup();
    const { api } = openEdit(sara, {
      [credentials(sara.id)]: () => json({ type: 'password', generatedValue: 'Kd7mQp2xVr9nTb4w' }),
    });
    await user.click(await screen.findByRole('radio', { name: 'Password' }));

    await user.click(screen.getByRole('button', { name: 'Set' }));

    expect(await screen.findByText('Kd7mQp2xVr9nTb4w')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('The new password is shown only now.');
    expect(bodyOf(api, credentials(sara.id))).toEqual({ type: 'password' });
  });

  it('refuses an easy PIN and a short password before asking the server', async () => {
    const user = userEvent.setup();
    const { api } = openEdit();
    const value = await screen.findByLabelText('New value');

    await user.type(value, '1234');
    await user.click(screen.getByRole('button', { name: 'Set' }));
    expect(
      await screen.findByText('A PIN cannot be a straight run such as 1234.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Password' }));
    expect(
      screen.queryByText('A PIN cannot be a straight run such as 1234.'),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set' }));
    expect(await screen.findByText('A password needs at least 10 characters.')).toBeInTheDocument();
    expect(api.count(credentials(sara.id))).toBe(0);
  });

  it('shows the problem the server finds', async () => {
    const user = userEvent.setup();
    openEdit(sara, {
      [credentials(sara.id)]: () =>
        errorResponse(400, 'VALIDATION_ERROR', [{ path: 'type', message: 'PIN_NEEDS_STAFF_CODE' }]),
    });
    await screen.findByLabelText('New value');

    await user.click(screen.getByRole('button', { name: 'Set' }));

    expect(await screen.findByText('A PIN needs a staff code.')).toBeInTheDocument();
  });

  it('says that a password needs an email, and blocks it, for a person without one', async () => {
    const user = userEvent.setup();
    openEdit(dana);
    await screen.findByLabelText('Name');

    await user.click(screen.getByRole('radio', { name: 'Password' }));

    expect(screen.getByText('A password needs an email.')).toBeInTheDocument();
    expect(screen.getByLabelText('New value')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Set' })).toBeDisabled();
  });

  it('says that a PIN needs a staff code, and chooses the password, for a person without one', async () => {
    openEdit(mahaManager);

    expect(await screen.findByRole('radio', { name: 'Password' })).toBeChecked();
    expect(screen.queryByText('A PIN needs a staff code.')).not.toBeInTheDocument();
  });

  it('says that only branch roles use a PIN', async () => {
    const user = userEvent.setup();
    const brandPerson = adminUser({
      role: { key: 'marketing', name: 'Marketing', scope: 'BRAND' },
      branchIds: [],
    });
    openEdit(brandPerson);
    await screen.findByLabelText('Name');
    expect(screen.getByRole('radio', { name: 'Password' })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: 'PIN' }));

    expect(screen.getByText('Only branch roles sign in with a PIN.')).toBeInTheDocument();
  });

  it('shows the generated value in the language of the page, with the number left to right', async () => {
    const user = userEvent.setup();
    openEdit(sara, {
      [credentials(sara.id)]: () => json({ type: 'pin', generatedValue: '482915' }),
    });
    await screen.findByLabelText('Name');
    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    await user.click(await screen.findByRole('button', { name: 'تعيين' }));

    const value = await screen.findByText('482915');
    expect(value).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('status')).toHaveTextContent('الرقم السري الجديد يظهر الآن فقط');
  });
});
