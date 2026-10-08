import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { formatDateTime } from '../../i18n/format';
import {
  auditRow,
  brandManager,
  cashier,
  groupAdmin,
  page,
  pizzaBrand,
  sara,
  sessionFor,
  userIds,
} from '../../test/fixtures';
import { errorResponse, json, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const REFRESH = 'POST /api/v1/auth/refresh';
const AUDIT = 'GET /api/v1/audit-logs';

const created = auditRow();
const failedLogin = auditRow({
  id: '01990000-0000-7000-8000-000000000302',
  action: 'auth.login.failed',
  userId: null,
  userName: null,
  entityType: null,
  entityId: null,
  metadata: { type: 'password', email: 'nobody@pos.local' },
  ip: '10.0.0.9',
  createdAt: '2026-10-08T11:00:00.000Z',
});
const plain = auditRow({
  id: '01990000-0000-7000-8000-000000000303',
  action: 'auth.logout',
  userName: 'Sara Cashier',
  userId: userIds.sara,
  entityType: null,
  entityId: null,
  metadata: {},
  ip: '10.0.0.7',
  createdAt: '2026-10-08T12:00:00.000Z',
});

function openAudit(rows = [created, failedLogin, plain]) {
  return mockApi({
    [REFRESH]: () => json(sessionFor(groupAdmin)),
    [AUDIT]: () => json(page(rows)),
  });
}
const lastQuery = (api: ReturnType<typeof openAudit>) =>
  api.calls.filter((call) => call.key === AUDIT).at(-1)?.url.searchParams;

describe('the audit log page', () => {
  it('shows when, what, who and from where for each event', async () => {
    openAudit();
    renderApp('/admin/audit');

    const row = (await screen.findByRole('cell', { name: 'User created' })).closest(
      'tr',
    ) as HTMLElement;

    expect(within(row).getByText(formatDateTime(created.createdAt, 'en'))).toBeInTheDocument();
    expect(within(row).getByText('Group Admin')).toBeInTheDocument();
    expect(within(row).getByText('10.0.0.5')).toBeInTheDocument();
  });

  it('writes each known action in words', async () => {
    openAudit();
    renderApp('/admin/audit');

    expect(await screen.findByRole('cell', { name: 'User created' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Failed sign-in' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Signed out' })).toBeInTheDocument();
  });

  it('shows an action it does not know as it is written', async () => {
    openAudit([auditRow({ action: 'menu.item.published' })]);
    renderApp('/admin/audit');

    expect(await screen.findByRole('cell', { name: 'menu.item.published' })).toBeInTheDocument();
  });

  it('shows a dash for an event with no person', async () => {
    openAudit([failedLogin]);
    renderApp('/admin/audit');

    const row = (await screen.findByText('Failed sign-in', { selector: 'td' })).closest(
      'tr',
    ) as HTMLElement;

    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  it('keeps the details folded until asked, and shows them as written', async () => {
    const user = userEvent.setup();
    openAudit();
    renderApp('/admin/audit');
    const row = (await screen.findByRole('cell', { name: 'User created' })).closest(
      'tr',
    ) as HTMLElement;
    const details = row.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);

    await user.click(within(row).getByText('Show'));

    expect(details.open).toBe(true);
    expect(within(row).getByText(/"entityType": "user"/)).toBeInTheDocument();
    expect(within(row).getByText(/"role": "cashier"/)).toBeInTheDocument();
  });

  it('shows no details control for an event with nothing to add', async () => {
    openAudit([plain]);
    renderApp('/admin/audit');

    const row = (await screen.findByText('Signed out', { selector: 'td' })).closest(
      'tr',
    ) as HTMLElement;

    expect(within(row).queryByText('Show')).not.toBeInTheDocument();
  });

  it('says so when there are no events', async () => {
    openAudit([]);
    renderApp('/admin/audit');

    expect(await screen.findByText('No events match these filters.')).toBeInTheDocument();
  });

  it('says so when the log cannot be loaded', async () => {
    mockApi({
      [REFRESH]: () => json(sessionFor(groupAdmin)),
      [AUDIT]: () => errorResponse(500, 'INTERNAL_ERROR'),
    });
    renderApp('/admin/audit');

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the data.');
  });

  it('loads the next page when asked', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      [REFRESH]: () => json(sessionFor(groupAdmin)),
      [AUDIT]: ({ url }) =>
        url.searchParams.get('cursor') ? json(page([plain])) : json(page([created], created.id)),
    });
    renderApp('/admin/audit');
    await screen.findByRole('cell', { name: 'User created' });

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByRole('cell', { name: 'Signed out' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'User created' })).toBeInTheDocument();
    expect(api.calls.filter((call) => call.key === AUDIT)[1]?.url.searchParams.get('cursor')).toBe(
      created.id,
    );
  });
});

describe('filters on the audit log', () => {
  it('asks for no filters at the start', async () => {
    const api = openAudit();
    renderApp('/admin/audit');
    await screen.findByRole('cell', { name: 'User created' });

    const query = lastQuery(api);
    expect(query?.get('action')).toBeNull();
    expect(query?.get('from')).toBeNull();
    expect(query?.get('userId')).toBeNull();
    expect(query?.get('limit')).toBe('50');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('filters by action, with the actions in words', async () => {
    const user = userEvent.setup();
    const api = openAudit();
    renderApp('/admin/audit');
    await screen.findByRole('cell', { name: 'User created' });

    const select = screen.getByLabelText('Action');
    expect(within(select).getByRole('option', { name: 'Account locked' })).toBeInTheDocument();
    await user.selectOptions(select, 'user.unlocked');

    await waitFor(() => expect(lastQuery(api)?.get('action')).toBe('user.unlocked'));
  });

  it('filters by a range of days, from the start of the first to the end of the last', async () => {
    const user = userEvent.setup();
    const api = openAudit();
    renderApp('/admin/audit');
    await screen.findByRole('cell', { name: 'User created' });

    await user.type(screen.getByLabelText('From'), '2026-10-01');
    await user.type(screen.getByLabelText('To'), '2026-10-09');

    await waitFor(() => expect(lastQuery(api)?.get('to')).not.toBeNull());
    expect(lastQuery(api)?.get('from')).toBe(new Date('2026-10-01T00:00:00').toISOString());
    expect(lastQuery(api)?.get('to')).toBe(new Date('2026-10-09T23:59:59.999').toISOString());
  });

  it('keeps the day pickers from choosing an end before the start', async () => {
    const user = userEvent.setup();
    openAudit();
    renderApp('/admin/audit');
    await screen.findByRole('cell', { name: 'User created' });

    await user.type(screen.getByLabelText('From'), '2026-10-05');
    await user.type(screen.getByLabelText('To'), '2026-10-09');

    expect(screen.getByLabelText('To')).toHaveAttribute('min', '2026-10-05');
    expect(screen.getByLabelText('From')).toHaveAttribute('max', '2026-10-09');
  });

  it('shows the activity of one person when the address names them, and can go back to everyone', async () => {
    const user = userEvent.setup();
    const api = openAudit();
    renderApp(`/admin/audit?userId=${sara.id}`);

    expect(await screen.findByText('Showing the activity of one person.')).toBeInTheDocument();
    expect(lastQuery(api)?.get('userId')).toBe(sara.id);

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    await waitFor(() => expect(lastQuery(api)?.get('userId')).toBeNull());
    expect(screen.queryByText('Showing the activity of one person.')).not.toBeInTheDocument();
  });

  it('clears every filter at once', async () => {
    const user = userEvent.setup();
    const api = openAudit();
    renderApp('/admin/audit');
    await screen.findByRole('cell', { name: 'User created' });
    await user.selectOptions(screen.getByLabelText('Action'), 'auth.logout');
    await user.type(screen.getByLabelText('From'), '2026-10-01');

    await user.click(await screen.findByRole('button', { name: 'Clear filters' }));

    await waitFor(() => expect(lastQuery(api)?.get('action')).toBeNull());
    expect(lastQuery(api)?.get('from')).toBeNull();
    expect(screen.getByLabelText('Action')).toHaveValue('');
    expect(screen.getByLabelText('From')).toHaveValue('');
  });
});

describe('the audit log in Arabic', () => {
  it('writes the headings, actions and dates in Arabic, with the address left to right', async () => {
    const user = userEvent.setup();
    openAudit();
    renderApp('/admin/audit');
    await screen.findByRole('cell', { name: 'User created' });

    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    expect(await screen.findByRole('heading', { name: 'سجل المراجعة' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'إنشاء مستخدم' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'محاولة دخول فاشلة' })).toBeInTheDocument();
    expect(screen.getByText(formatDateTime(created.createdAt, 'ar'))).toBeInTheDocument();
    expect(screen.getByText('10.0.0.5')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('columnheader', { name: 'الوقت' })).toBeInTheDocument();
  });

  it('lists the actions in Arabic in the filter', async () => {
    const user = userEvent.setup();
    openAudit();
    renderApp('/admin/audit');
    await screen.findByRole('cell', { name: 'User created' });

    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    const select = await screen.findByLabelText('الإجراء');
    expect(within(select).getByRole('option', { name: 'فك قفل مستخدم' })).toBeInTheDocument();
  });
});

describe('who may open the audit log', () => {
  it('lets a brand manager with the permission in', async () => {
    mockApi({
      [REFRESH]: () =>
        json(sessionFor({ ...brandManager, permissions: ['audit:read', 'brands:read'] })),
      [AUDIT]: () => json(page([created])),
    });
    renderApp('/admin/audit');

    expect(await screen.findByRole('cell', { name: 'User created' })).toBeInTheDocument();
  });

  it('tells a cashier they may not, and asks the server for nothing', async () => {
    const api = mockApi({
      [REFRESH]: () => json(sessionFor(cashier)),
      [`GET /api/v1/brands/${pizzaBrand.id}/branches`]: () => json(page([])),
    });
    renderApp('/admin/audit');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to open this page.',
    );
    expect(api.count(AUDIT)).toBe(0);
  });
});
