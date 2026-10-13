import type { Ingredient, StockCount, StockCountSummary } from '@pos/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { describe, expect, it } from 'vitest';
import {
  branchManager,
  fullBrandManager,
  ids,
  page,
  pizzaBrand,
  pizzaDowntown,
  pizzaMall,
  sessionFor,
} from '../../test/fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const countId = '01990000-0000-7000-8000-00000000c001';
const LIST = 'GET /api/v1/inventory/counts';
const START = 'POST /api/v1/inventory/counts';
const ONE = `GET /api/v1/inventory/counts/${countId}`;
const SAVE = `PUT /api/v1/inventory/counts/${countId}/lines`;
const FINISH = `POST /api/v1/inventory/counts/${countId}/finish`;
const CANCEL = `POST /api/v1/inventory/counts/${countId}/cancel`;
const INGREDIENTS = 'GET /api/v1/inventory/ingredients';

const flour: Ingredient = {
  id: '01990000-0000-7000-8000-000000009001',
  brandId: ids.pizza,
  name: { en: 'Flour', ar: 'طحين' },
  unit: 'kg',
  costPerUnit: '0.400',
  lowLevel: '5.000',
  isActive: true,
};
const mozzarella: Ingredient = {
  ...flour,
  id: '01990000-0000-7000-8000-000000009002',
  name: { en: 'Mozzarella', ar: 'موزاريلا' },
  costPerUnit: '3.000',
};

const summary: StockCountSummary = {
  id: countId,
  number: 4,
  branchId: ids.pizzaMall,
  status: 'open',
  note: null,
  lineCount: 2,
  countedCount: 0,
  lostValue: '0.000',
  foundValue: '0.000',
  startedByName: 'Mall Branch Manager',
  startedAt: '2026-10-14T21:00:00.000Z',
  finishedByName: null,
  finishedAt: null,
  cancelledByName: null,
  cancelledAt: null,
  cancelReason: null,
};

// Count 4 at the Mall, expecting 10 kg of flour and 4 kg of mozzarella, nothing typed yet.
const open: StockCount = {
  ...summary,
  lines: [
    { ingredient: flour, expected: '10.000', counted: null, difference: null, value: null },
    { ingredient: mozzarella, expected: '4.000', counted: null, difference: null, value: null },
  ],
};

const finished: StockCount = {
  ...open,
  status: 'finished',
  countedCount: 1,
  lostValue: '-0.200',
  finishedByName: 'Mall Branch Manager',
  finishedAt: '2026-10-14T22:00:00.000Z',
  lines: [
    {
      ingredient: flour,
      expected: '10.000',
      counted: '9.500',
      difference: '-0.500',
      value: '-0.200',
    },
    { ingredient: mozzarella, expected: '4.000', counted: null, difference: null, value: null },
  ],
};

const mallManager = {
  ...branchManager,
  permissions: [
    ...branchManager.permissions,
    'inventory:read' as const,
    'inventory:write' as const,
  ],
};

// The count as the server has it now: what a write answers is what GET answers next.
let current: StockCount = open;

function countsApi(user = mallManager, handlers: Record<string, MockHandler> = {}) {
  current = open;
  const remembered = Object.fromEntries(
    Object.entries(handlers).map(([key, handler]) => [
      key,
      async (request: Parameters<MockHandler>[0]) => {
        const response = await handler(request);
        if (key !== LIST && key !== START && response.ok) {
          current = (await response.clone().json()) as StockCount;
        }
        return response;
      },
    ]),
  );
  const branches = user.scope === 'BRANCH' ? [pizzaMall] : [pizzaMall, pizzaDowntown];
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(user)),
    'GET /api/v1/brands': () => json(page([pizzaBrand])),
    [`GET /api/v1/brands/${ids.pizza}/branches`]: () => json(page(branches)),
    [LIST]: () => json(page([summary])),
    [ONE]: () => json(current),
    [INGREDIENTS]: () => json(page([flour, mozzarella])),
    ...remembered,
  });
}

const bodyOf = (mock: ReturnType<typeof mockApi>, key: string) =>
  mock.calls.filter((call) => call.key === key).map((call) => call.body);

describe('the counts of a branch', () => {
  it('are listed with how much is counted, and an open count is continued', async () => {
    countsApi();
    const user = userEvent.setup();
    renderApp('/admin/inventory/counts');

    const rows = await screen.findAllByRole('row');
    const row = rows[1] as HTMLElement;
    expect(within(row).getByText('#4')).toBeVisible();
    expect(within(row).getByText('Open')).toBeVisible();
    expect(within(row).getByText('0 of 2 counted')).toBeVisible();
    // An open count blocks a second one.
    expect(screen.queryByRole('button', { name: 'New count' })).not.toBeInTheDocument();

    await user.click(within(row).getByRole('link', { name: 'Open count 4' }));
    expect(await screen.findByRole('heading', { name: 'Count 4' })).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Back to the counts' }));
    expect(await screen.findByText('0 of 2 counted')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Count 4' })).not.toBeInTheDocument();
  });

  it('starts a count of some ingredients and opens it', async () => {
    const api = countsApi(mallManager, {
      [LIST]: () => json(page([])),
      [START]: () => json(open, 201),
    });
    const user = userEvent.setup();
    renderApp('/admin/inventory/counts');

    expect(await screen.findByText('No count yet.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'New count' }));
    const dialog = screen.getByRole('dialog', { name: 'New count' });
    await user.click(within(dialog).getByLabelText('Only some ingredients'));
    await user.click(within(dialog).getByRole('button', { name: 'Start the count' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose an ingredient.');

    await user.click(await within(dialog).findByLabelText('Mozzarella'));
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Cheese check');
    await user.click(within(dialog).getByRole('button', { name: 'Start the count' }));

    expect(await screen.findByRole('heading', { name: 'Count 4' })).toBeVisible();
    expect(bodyOf(api, START)).toEqual([
      { branchId: ids.pizzaMall, note: 'Cheese check', ingredientIds: [mozzarella.id] },
    ]);
  });

  it('shows the answer when a count is already open', async () => {
    countsApi(fullBrandManager, {
      [LIST]: () => json(page([])),
      [START]: () => errorResponse(409, 'COUNT_ALREADY_OPEN'),
    });
    const user = userEvent.setup();
    renderApp('/admin/inventory/counts');

    await user.click(await screen.findByRole('button', { name: 'New count' }));
    const dialog = screen.getByRole('dialog', { name: 'New count' });
    expect(within(dialog).getByLabelText('Every ingredient (2)')).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Start the count' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'A count is already open at this branch.',
    );
  });
});

describe('a count', () => {
  it('shows the difference as it is typed, saves and finishes after a confirmation', async () => {
    const api = countsApi(mallManager, {
      [SAVE]: () =>
        json({
          ...open,
          countedCount: 1,
          lines: [
            { ...open.lines[0], counted: '9.500', difference: '-0.500', value: '-0.200' },
            open.lines[1],
          ],
        }),
      [FINISH]: () => json(finished),
    });
    const user = userEvent.setup();
    renderApp(`/admin/inventory/counts/${countId}`);

    const flourBox = await screen.findByLabelText('Flour');
    await user.type(flourBox, '9.5');
    const row = flourBox.closest('tr') as HTMLElement;
    expect(within(row).getByText('-0.500').closest('td')).toHaveClass('text-red-700');
    expect(within(row).getByText('-0.200')).toBeVisible();
    expect(screen.getByText('1 of 2 counted')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    expect(bodyOf(api, SAVE)).toEqual([{ lines: [{ ingredientId: flour.id, counted: '9.500' }] }]);

    await user.click(screen.getByRole('button', { name: 'Finish the count' }));
    const confirm = screen.getByRole('dialog', { name: 'Finish the count?' });
    expect(within(confirm).getByText('1 of 2 counted')).toBeVisible();
    await user.click(within(confirm).getByRole('button', { name: 'Finish and set the stock' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Count finished.');
    expect(api.calls.some((call) => call.key === FINISH)).toBe(true);
    expect(screen.getByText('Finished')).toBeVisible();
    expect(screen.getByText('Not counted')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Finish the count' })).not.toBeInTheDocument();
  });

  it('saves what was typed before finishing, and refuses a quantity that is not one', async () => {
    const api = countsApi(mallManager, {
      [SAVE]: () => json(open),
      [FINISH]: () => errorResponse(409, 'COUNT_EMPTY'),
    });
    const user = userEvent.setup();
    renderApp(`/admin/inventory/counts/${countId}`);

    const box = await screen.findByLabelText('Mozzarella');
    await user.type(box, '4.1234');
    await user.click(screen.getByRole('button', { name: 'Finish the count' }));
    expect(box).toHaveAccessibleDescription('Type a quantity of 0 or more, with up to 3 decimals.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.clear(box);
    await user.type(box, '4');
    await user.click(screen.getByRole('button', { name: 'Finish the count' }));
    await user.click(screen.getByRole('button', { name: 'Finish and set the stock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Type at least one counted quantity before finishing.',
    );
    expect(bodyOf(api, SAVE)).toEqual([
      { lines: [{ ingredientId: mozzarella.id, counted: '4.000' }] },
    ]);
  });

  it('is cancelled with a reason', async () => {
    const api = countsApi(mallManager, {
      [CANCEL]: () =>
        json({
          ...open,
          status: 'cancelled',
          cancelledByName: 'Mall Branch Manager',
          cancelledAt: '2026-10-14T22:00:00.000Z',
          cancelReason: 'Started by mistake',
        }),
    });
    const user = userEvent.setup();
    renderApp(`/admin/inventory/counts/${countId}`);

    await user.click(await screen.findByRole('button', { name: 'Cancel the count' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel the count' });
    await user.click(within(dialog).getByRole('button', { name: 'Confirm the cancellation' }));
    expect(within(dialog).getByText('Say why.')).toBeVisible();
    await user.type(within(dialog).getByLabelText('Why is it cancelled?'), 'Started by mistake');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm the cancellation' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Count cancelled.');
    expect(bodyOf(api, CANCEL)).toEqual([{ reason: 'Started by mistake' }]);
    expect(screen.getByText(/Cancelled by Mall Branch Manager/)).toHaveTextContent(
      'Started by mistake',
    );
  });

  it('is read only for a person who may only see the stock', async () => {
    countsApi({ ...branchManager, permissions: ['branches:read', 'inventory:read'] });
    renderApp(`/admin/inventory/counts/${countId}`);

    expect(await screen.findByRole('heading', { name: 'Count 4' })).toBeVisible();
    expect(screen.queryByLabelText('Flour')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish the count' })).not.toBeInTheDocument();
  });

  it('shows the words of the screen in Arabic', async () => {
    await i18n.changeLanguage('ar');
    countsApi();
    renderApp(`/admin/inventory/counts/${countId}`);

    expect(await screen.findByRole('heading', { name: 'الجرد 4' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'إنهاء الجرد' })).toBeVisible();
    await i18n.changeLanguage('en');
  });
});
