import type { SalesReport } from '@pos/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  branchManager,
  cashier,
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

const SALES = 'GET /api/v1/reports/sales';

const report: SalesReport = {
  from: '2026-10-14',
  to: '2026-10-14',
  summary: {
    orders: 2,
    grossSales: '50.000',
    discounts: '3.000',
    netSales: '47.000',
    refunds: '5.000',
    netAfterRefunds: '42.000',
    commissions: '0.900',
    averageOrder: '23.500',
    voidedOrders: 1,
  },
  days: [{ date: '2026-10-14', orders: 2, netSales: '47.000', refunds: '5.000' }],
  payments: [
    {
      method: 'cash',
      name: { en: 'Cash', ar: 'نقدًا' },
      count: 1,
      amount: '27.000',
      refunds: '5.000',
      commission: '0.000',
      net: '22.000',
    },
    {
      method: 'knet',
      name: { en: 'KNET', ar: 'كي نت' },
      count: 1,
      amount: '15.000',
      refunds: '0.000',
      commission: '0.000',
      net: '15.000',
    },
    {
      method: 'talabat',
      name: { en: 'Talabat', ar: 'طلبات' },
      count: 1,
      amount: '5.000',
      refunds: '0.000',
      commission: '0.900',
      net: '4.100',
    },
  ],
  items: [
    {
      kind: 'item',
      id: '01990000-0000-7000-8000-000000000401',
      name: { en: 'Margherita', ar: 'مارجريتا' },
      quantity: 3,
      sales: '60.000',
      foodCost: '7.200',
      foodCostPercent: 12,
    },
    {
      kind: 'combo',
      id: '01990000-0000-7000-8000-000000000501',
      name: { en: 'Family meal', ar: 'وجبة العائلة' },
      quantity: 1,
      sales: '25.000',
      foodCost: null,
      foodCostPercent: null,
    },
  ],
  categories: [
    {
      id: '01990000-0000-7000-8000-000000000301',
      name: { en: 'Pizzas', ar: 'بيتزا' },
      quantity: 3,
      sales: '60.000',
    },
    { id: null, name: null, quantity: 1, sales: '25.000' },
  ],
};

const manager = {
  ...branchManager,
  permissions: [...branchManager.permissions, 'reports:read' as const],
};

function reportsApi(user = fullBrandManager, handlers: Record<string, MockHandler> = {}) {
  return mockApi({
    'POST /api/v1/auth/refresh': () => json(sessionFor(user)),
    'GET /api/v1/brands': () => json(page([pizzaBrand])),
    [`GET /api/v1/brands/${ids.pizza}/branches`]: () => json(page([pizzaMall, pizzaDowntown])),
    'GET /api/v1/inventory/alerts': () => json({ data: [] }),
    [SALES]: () => json(report),
    ...handlers,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the sales report', () => {
  it('shows the summary, and the tables by day, payment, item and category', async () => {
    reportsApi();
    renderApp('/admin/reports');

    const summary = await screen.findByLabelText('Summary');
    const figure = (label: string) => within(summary).getByText(label).nextElementSibling;
    expect(figure('Orders')).toHaveTextContent('2');
    expect(figure('Gross sales')).toHaveTextContent('50.000 KWD');
    expect(figure('Net after refunds')).toHaveTextContent('42.000 KWD');
    expect(figure('Average order')).toHaveTextContent('23.500 KWD');
    expect(figure('Voided orders')).toHaveTextContent('1');

    const payments = screen.getByRole('region', { name: 'By payment method' });
    expect(within(payments).getAllByRole('row')[1]).toHaveTextContent(
      'Cash127.000 KWD5.000 KWD0.000 KWD22.000 KWD',
    );
    // A delivery platform's commission comes off its net (spec 025).
    expect(within(payments).getAllByRole('row')[3]).toHaveTextContent(
      'Talabat15.000 KWD0.000 KWD0.900 KWD4.100 KWD',
    );
    expect(figure('Platform commission')).toHaveTextContent('0.900 KWD');
    const items = screen.getByRole('region', { name: 'By item' });
    expect(within(items).getAllByRole('row')[1]).toHaveTextContent(
      'Margherita360.000 KWD7.200 KWD12%',
    );
    expect(within(items).getAllByRole('row')[2]).toHaveTextContent('Family mealCombo');
    const categories = screen.getByRole('region', { name: 'By category' });
    expect(within(categories).getAllByRole('row')[2]).toHaveTextContent('Combos125.000 KWD');
  });

  it('asks for the last 7 days of every branch first, then the period and branch chosen', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-14T10:00:00'), shouldAdvanceTime: true });
    const api = reportsApi();
    const user = userEvent.setup();
    renderApp('/admin/reports');

    await screen.findByLabelText('Summary');
    const first = api.calls.find((call) => call.key === SALES)?.url.searchParams;
    expect(Object.fromEntries(first ?? [])).toEqual({ from: '2026-10-08', to: '2026-10-14' });

    await user.selectOptions(screen.getByLabelText('Branch'), 'Pizza Palace - Mall Branch');
    await user.click(screen.getByRole('button', { name: 'Yesterday' }));
    await vi.waitFor(() => {
      const last = api.calls.filter((call) => call.key === SALES).at(-1)?.url.searchParams;
      expect(Object.fromEntries(last ?? [])).toEqual({
        from: '2026-10-13',
        to: '2026-10-13',
        branchId: ids.pizzaMall,
      });
    });
  });

  it('shows the answer for a period that is too long', async () => {
    reportsApi(fullBrandManager, {
      [SALES]: () =>
        errorResponse(400, 'VALIDATION_ERROR', [{ path: 'to', message: 'RANGE_TOO_LONG' }]),
    });
    renderApp('/admin/reports');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose a period of at most 92 days.',
    );
  });

  it('downloads the items as a CSV file', async () => {
    reportsApi();
    const created: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return 'blob:report';
    });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderApp('/admin/reports');

    const items = await screen.findByRole('region', { name: 'By item' });
    await user.click(within(items).getByRole('button', { name: 'Download CSV' }));
    expect(click).toHaveBeenCalled();
    // The file starts with the byte order mark, so Excel reads the Arabic names.
    const bytes = new Uint8Array((await created[0]?.arrayBuffer()) ?? new ArrayBuffer(0));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await created[0]?.text();
    expect(text?.split('\n')).toEqual([
      'Item,Quantity,Sales,Food cost,Food cost %',
      'Margherita,3,60.000,7.200,12',
      'Family meal,1,25.000,,',
    ]);
    click.mockRestore();
  });

  it('is in the menu for a branch manager with the permission, not for a cashier', async () => {
    reportsApi(manager);
    renderApp('/admin');
    expect(await screen.findByRole('link', { name: 'Reports' })).toBeVisible();
  });

  it('is not open to a cashier', async () => {
    reportsApi(cashier);
    renderApp('/admin/reports');
    expect(await screen.findByText('You do not have permission to open this page.')).toBeVisible();
  });

  it('is shown in Arabic', async () => {
    await i18n.changeLanguage('ar');
    reportsApi();
    renderApp('/admin/reports');
    expect(await screen.findByRole('heading', { name: 'التقارير' })).toBeVisible();
    expect(await screen.findByText('صافي المبيعات', { selector: 'p' })).toBeVisible();
    await i18n.changeLanguage('en');
  });
});
