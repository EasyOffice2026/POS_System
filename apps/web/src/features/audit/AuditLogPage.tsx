import { type AuditAction, auditActions } from '@pos/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { fieldClass, secondaryButtonClass } from '../../components/form';
import { formatDateTime } from '../../i18n/format';
import { type AuditFilters, listAuditPage } from './audit-api';

// i18n keys cannot hold a dot, so each action has its own text key.
const actionKeys = {
  'auth.login.success': 'audit.actions.auth_login_success',
  'auth.login.failed': 'audit.actions.auth_login_failed',
  'auth.login.locked': 'audit.actions.auth_login_locked',
  'auth.login.blocked': 'audit.actions.auth_login_blocked',
  'auth.logout': 'audit.actions.auth_logout',
  'auth.refresh.reuse_detected': 'audit.actions.auth_refresh_reuse_detected',
  'auth.password_changed': 'audit.actions.auth_password_changed',
  'user.created': 'audit.actions.user_created',
  'user.updated': 'audit.actions.user_updated',
  'user.credentials_reset': 'audit.actions.user_credentials_reset',
  'user.unlocked': 'audit.actions.user_unlocked',
  'brand.created': 'audit.actions.brand_created',
  'brand.updated': 'audit.actions.brand_updated',
  'branch.created': 'audit.actions.branch_created',
  'branch.updated': 'audit.actions.branch_updated',
  'branch.tables_updated': 'audit.actions.branch_tables_updated',
  'menu.category.created': 'audit.actions.menu_category_created',
  'menu.category.updated': 'audit.actions.menu_category_updated',
  'menu.category.reordered': 'audit.actions.menu_category_reordered',
  'menu.item.created': 'audit.actions.menu_item_created',
  'menu.item.updated': 'audit.actions.menu_item_updated',
  'menu.item.branch_override_set': 'audit.actions.menu_item_branch_override_set',
  'menu.modifier_group.created': 'audit.actions.menu_modifier_group_created',
  'menu.modifier_group.updated': 'audit.actions.menu_modifier_group_updated',
  'menu.modifier.created': 'audit.actions.menu_modifier_created',
  'menu.modifier.updated': 'audit.actions.menu_modifier_updated',
  'menu.combo.created': 'audit.actions.menu_combo_created',
  'menu.combo.updated': 'audit.actions.menu_combo_updated',
  'order.voided': 'audit.actions.order_voided',
  'order.line_voided': 'audit.actions.order_line_voided',
  'order.discount_set': 'audit.actions.order_discount_set',
  'order.discount_removed': 'audit.actions.order_discount_removed',
  'brand.settings_updated': 'audit.actions.brand_settings_updated',
  'shift.opened': 'audit.actions.shift_opened',
  'shift.closed': 'audit.actions.shift_closed',
  'order.refunded': 'audit.actions.order_refunded',
  'ingredient.created': 'audit.actions.ingredient_created',
  'ingredient.updated': 'audit.actions.ingredient_updated',
  'menu.recipe.updated': 'audit.actions.menu_recipe_updated',
  'inventory.transfer.sent': 'audit.actions.inventory_transfer_sent',
  'inventory.transfer.received': 'audit.actions.inventory_transfer_received',
  'inventory.transfer.cancelled': 'audit.actions.inventory_transfer_cancelled',
  'inventory.count.started': 'audit.actions.inventory_count_started',
  'inventory.count.finished': 'audit.actions.inventory_count_finished',
  'inventory.count.cancelled': 'audit.actions.inventory_count_cancelled',
  'inventory.supplier.created': 'audit.actions.inventory_supplier_created',
  'inventory.supplier.updated': 'audit.actions.inventory_supplier_updated',
  'inventory.supplier.prices_updated': 'audit.actions.inventory_supplier_prices_updated',
  'inventory.purchase_order.created': 'audit.actions.inventory_purchase_order_created',
  'inventory.purchase_order.updated': 'audit.actions.inventory_purchase_order_updated',
  'inventory.purchase_order.sent': 'audit.actions.inventory_purchase_order_sent',
  'inventory.purchase_order.cancelled': 'audit.actions.inventory_purchase_order_cancelled',
  'inventory.purchase_order.received': 'audit.actions.inventory_purchase_order_received',
  'menu.promotion.created': 'audit.actions.menu_promotion_created',
  'menu.promotion.updated': 'audit.actions.menu_promotion_updated',
  'customer.created': 'audit.actions.customer_created',
  'customer.updated': 'audit.actions.customer_updated',
  'customer.points_adjusted': 'audit.actions.customer_points_adjusted',
} as const satisfies Record<AuditAction, string>;

type ActionKey = (typeof actionKeys)[AuditAction];

// A date from a date field covers that whole day, in the person's own time zone.
const startOfDay = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const endOfDay = (day: string) => new Date(`${day}T23:59:59.999`).toISOString();

export function AuditLogPage() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const userId = searchParams.get('userId') ?? undefined;

  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filters: AuditFilters = {
    ...(userId ? { userId } : {}),
    ...(action ? { action } : {}),
    ...(from ? { from: startOfDay(from) } : {}),
    ...(to ? { to: endOfDay(to) } : {}),
  };
  const filtered = Object.keys(filters).length > 0;

  const events = useInfiniteQuery({
    queryKey: ['audit', filters],
    queryFn: ({ pageParam }) => listAuditPage(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = events.data?.pages.flatMap((page) => page.data) ?? [];

  function actionLabel(value: string): string {
    const key = (actionKeys as Record<string, ActionKey | undefined>)[value];
    return key ? t(key) : value;
  }

  function clearFilters() {
    setAction('');
    setFrom('');
    setTo('');
    setSearchParams({});
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('audit.title')}</h1>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-medium text-slate-700">
          {t('audit.filterAction')}
          <select
            value={action}
            onChange={(event) => setAction(event.target.value)}
            className={fieldClass}
          >
            <option value="">{t('common.all')}</option>
            {auditActions.map((value) => (
              <option key={value} value={value}>
                {actionLabel(value)}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium text-slate-700">
          {t('audit.filterFrom')}
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
            className={fieldClass}
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          {t('audit.filterTo')}
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
            className={fieldClass}
          />
        </label>
      </div>

      {filtered && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
          {userId && <p>{t('audit.onePerson')}</p>}
          <button type="button" onClick={clearFilters} className={secondaryButtonClass}>
            {t('audit.clear')}
          </button>
        </div>
      )}

      {events.isPending && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {events.isError && (
        <p role="alert" className="text-sm text-red-700">
          {t('common.loadError')}
        </p>
      )}
      {events.isSuccess && rows.length === 0 && (
        <p className="text-sm text-slate-500">{t('audit.empty')}</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-start text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('audit.columns.when')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('audit.columns.action')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('audit.columns.person')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('audit.columns.details')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {t('audit.columns.address')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => {
                const details = {
                  ...(row.entityType ? { entityType: row.entityType } : {}),
                  ...(row.entityId ? { entityId: row.entityId } : {}),
                  ...row.metadata,
                };
                return (
                  <tr key={row.id} className="align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                      {formatDateTime(row.createdAt, i18n.language)}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {actionLabel(row.action)}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {row.userName ?? t('audit.unknownPerson')}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {Object.keys(details).length > 0 && (
                        <details>
                          <summary className="cursor-pointer underline">
                            {t('audit.showDetails')}
                          </summary>
                          <pre dir="ltr" className="mt-1 text-xs whitespace-pre-wrap">
                            {JSON.stringify(details, null, 2)}
                          </pre>
                        </details>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700" dir="ltr">
                      {row.ip ?? ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {events.hasNextPage && (
        <button
          type="button"
          disabled={events.isFetchingNextPage}
          onClick={() => void events.fetchNextPage()}
          className={secondaryButtonClass}
        >
          {events.isFetchingNextPage ? t('common.loading') : t('common.loadMore')}
        </button>
      )}
    </div>
  );
}
