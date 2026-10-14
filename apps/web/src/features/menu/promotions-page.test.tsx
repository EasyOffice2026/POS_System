import type { Promotion } from '@pos/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
import { drinksCategory, pizzasCategory, sidesCategory } from '../../test/menu-fixtures';
import { errorResponse, json, type MockHandler, mockApi } from '../../test/mock-api';
import { renderApp } from '../../test/render-app';

const LIST = 'GET /api/v1/menu/promotions';
const CREATE = 'POST /api/v1/menu/promotions';
const promotionId = '01990000-0000-7000-8000-00000000f001';
const UPDATE = `PATCH /api/v1/menu/promotions/${promotionId}`;
const PAGE = '/admin/menu/promotions';

const happyHour: Promotion = {
  id: promotionId,
  brandId: ids.pizza,
  name: { en: 'Happy hour', ar: 'ساعة سعيدة' },
  kind: 'percent_off',
  value: '20.00',
  buyQuantity: null,
  getQuantity: null,
  appliesTo: 'categories',
  categoryIds: [drinksCategory.id],
  itemIds: [],
  branchIds: [],
  startsOn: null,
  endsOn: null,
  days: [],
  startTime: '15:00',
  endTime: '18:00',
  code: null,
  sortOrder: 0,
  isActive: true,
};

const welcome: Promotion = {
  ...happyHour,
  id: '01990000-0000-7000-8000-00000000f002',
  name: { en: 'Welcome', ar: 'أهلًا' },
  value: '10.00',
  appliesTo: 'all',
  categoryIds: [],
  startTime: null,
  endTime: null,
  code: 'WELCOME',
  sortOrder: 1,
};

const marketing = {
  ...fullBrandManager,
  permissions: [
    'brands:read' as const,
    'branches:read' as const,
    'menu:read' as const,
    'promotions:write' as const,
  ],
};

function promotionsApi(user = fullBrandManager, handlers: Record<string, MockHandler> = {}) {
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(user)),
    'GET /api/v1/brands': () => json(page([pizzaBrand])),
    [`GET /api/v1/brands/${ids.pizza}/branches`]: () => json(page([pizzaMall, pizzaDowntown])),
    'GET /api/v1/menu/categories': () =>
      json({ data: [pizzasCategory, sidesCategory, drinksCategory] }),
    [LIST]: () => json({ data: [happyHour, welcome] }),
    ...handlers,
  });
}

const bodyOf = (mock: ReturnType<typeof mockApi>, key: string) =>
  mock.calls.find((call) => call.key === key)?.body;

describe('the promotions of a brand', () => {
  it('are listed with what they give, on what and when, and their code', async () => {
    promotionsApi();
    renderApp(PAGE);

    const first = (await screen.findByText('Happy hour')).closest('li') as HTMLElement;
    expect(first).toHaveTextContent('20% off · 1 category · 15:00–18:00');
    const second = screen.getByText('Welcome').closest('li') as HTMLElement;
    expect(second).toHaveTextContent('WELCOME');
    expect(second).toHaveTextContent('10% off · every dish');
  });

  it('are added with the numbers of their kind, on chosen categories and days', async () => {
    const api = promotionsApi(marketing, {
      [CREATE]: ({ body }) => json({ ...happyHour, ...(body as object), id: welcome.id }, 201),
    });
    const user = userEvent.setup();
    renderApp(PAGE);

    await user.click(await screen.findByRole('button', { name: 'Add a promotion' }));
    await user.type(screen.getByLabelText('Name (English)'), 'Two plus one');
    await user.type(screen.getByLabelText('Name (Arabic)'), 'اثنان وواحد');
    await user.selectOptions(screen.getByLabelText('What it gives'), 'Buy some, get some free');
    await user.click(screen.getByLabelText('Some categories'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Choose a category.')).toBeVisible();

    await user.click(await screen.findByRole('checkbox', { name: 'Pizzas' }));
    await user.click(screen.getByRole('checkbox', { name: 'Tue' }));
    await user.click(screen.getByRole('checkbox', { name: 'Pizza Palace - Mall Branch' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('button', { name: 'Add a promotion' });
    expect(bodyOf(api, CREATE)).toEqual({
      brandId: ids.pizza,
      name: { en: 'Two plus one', ar: 'اثنان وواحد' },
      kind: 'buy_get',
      value: null,
      buyQuantity: 2,
      getQuantity: 1,
      appliesTo: 'categories',
      categoryIds: [pizzasCategory.id],
      itemIds: [],
      branchIds: [ids.pizzaMall],
      days: [2],
      startTime: null,
      endTime: null,
      startsOn: null,
      endsOn: null,
      code: null,
      sortOrder: 2,
      isActive: true,
    });
  });

  it('are changed, and show the answer when a code is taken', async () => {
    const api = promotionsApi(fullBrandManager, {
      [UPDATE]: () =>
        errorResponse(400, 'VALIDATION_ERROR', [{ path: 'code', message: 'PROMO_CODE_TAKEN' }]),
    });
    const user = userEvent.setup();
    renderApp(PAGE);

    await user.click(await screen.findByRole('button', { name: 'Edit Happy hour' }));
    const form = screen.getByRole('heading', { name: 'Edit' }).closest('form') as HTMLElement;
    expect(within(form).getByLabelText('Percentage off')).toHaveValue('20.00');
    expect(within(form).getByLabelText('From (time)')).toHaveValue('15:00');
    await user.type(within(form).getByLabelText('Code (optional)'), 'welcome');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(
      await within(form).findByText('Another promotion of the brand has this code.'),
    ).toBeVisible();
    expect(bodyOf(api, UPDATE)).toMatchObject({ code: 'WELCOME', value: '20.00', sortOrder: 0 });
  });

  it('can only be read by a person without the permission', async () => {
    promotionsApi({ ...branchManager, permissions: ['branches:read', 'menu:read'] });
    renderApp(PAGE);
    expect(await screen.findByText('Happy hour')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add a promotion' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Happy hour' })).not.toBeInTheDocument();
  });
});
