import type { Permission } from '@pos/shared';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  ChefHat,
  Clock3,
  HeartHandshake,
  KeyRound,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  MonitorSmartphone,
  Package,
  ScrollText,
  Settings,
  ShieldCheck,
  Store,
  Tags,
  Users,
  X,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet } from 'react-router';
import { BrandMark } from '../../components/BrandMark';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import { localize } from '../../i18n/localize';
import { useBrandColor } from '../../lib/use-brand-color';
import { useAuth } from '../auth/auth-context';
import { getBrand } from '../brands/brands-api';
import { useBrandSettings } from '../settings/settings-api';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors [&_svg]:size-[18px] [&_svg]:shrink-0 ${
    isActive
      ? 'bg-slate-100 font-semibold text-ink shadow-[inset_3px_0_0_var(--color-brand)] rtl:shadow-[inset_-3px_0_0_var(--color-brand)] [&_svg]:text-ink'
      : 'font-medium text-slate-600 hover:bg-slate-50 hover:text-ink [&_svg]:text-slate-400'
  }`;

interface Entry {
  to: string;
  label: string;
  icon: ReactNode;
  permission: Permission | null;
  end?: boolean;
}

// The back office: a sidebar in groups with icons (the redesign, B1), and the page beside it.
// On a phone the sidebar slides in from the menu button.
export function AdminLayout() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const can = (permission: Permission) => user?.permissions.includes(permission) ?? false;
  // The people of one brand see its mark and colour; the group admin sees the system's.
  const brandId = user?.brandId ?? null;
  const brand = useQuery({
    queryKey: ['brands', 'detail', brandId],
    queryFn: () => getBrand(brandId ?? ''),
    enabled: brandId !== null && can('brands:read'),
  });
  const look = useBrandSettings(brandId);
  useBrandColor(look.data?.appearance.color);
  const markName = brand.data ? localize(brand.data.name, i18n.language) : t('app.name');

  const groups: { label: string; entries: Entry[] }[] = [
    {
      label: t('nav.groups.today'),
      entries: [
        {
          to: '/admin',
          label: t('nav.dashboard'),
          icon: <LayoutDashboard aria-hidden="true" />,
          permission: null,
          end: true,
        },
        {
          to: '/admin/reports',
          label: t('nav.reports'),
          icon: <LineChart aria-hidden="true" />,
          permission: 'reports:read',
        },
      ],
    },
    {
      label: t('nav.groups.sell'),
      entries: [
        {
          to: '/pos',
          label: t('nav.pos'),
          icon: <MonitorSmartphone aria-hidden="true" />,
          permission: 'orders:write',
        },
        {
          to: '/kds',
          label: t('nav.kds'),
          icon: <ChefHat aria-hidden="true" />,
          permission: 'kitchen:write',
        },
        {
          to: '/admin/shifts',
          label: t('nav.shifts'),
          icon: <Clock3 aria-hidden="true" />,
          permission: 'shifts:read',
        },
      ],
    },
    {
      label: t('nav.groups.stock'),
      entries: [
        {
          to: '/admin/menu',
          label: t('nav.menu'),
          icon: <BookOpen aria-hidden="true" />,
          permission: 'menu:read',
        },
        {
          to: '/admin/inventory',
          label: t('nav.inventory'),
          icon: <Package aria-hidden="true" />,
          permission: 'inventory:read',
        },
      ],
    },
    {
      label: t('nav.groups.people'),
      entries: [
        {
          to: '/admin/customers',
          label: t('nav.customers'),
          icon: <HeartHandshake aria-hidden="true" />,
          permission: 'customers:read',
        },
        {
          to: '/admin/users',
          label: t('nav.users'),
          icon: <Users aria-hidden="true" />,
          permission: 'users:read',
        },
        {
          to: '/admin/roles',
          label: t('nav.roles'),
          icon: <ShieldCheck aria-hidden="true" />,
          permission: 'roles:read',
        },
      ],
    },
    {
      label: t('nav.groups.business'),
      entries: [
        {
          to: '/admin/brands',
          label: t('nav.brands'),
          icon: <Tags aria-hidden="true" />,
          permission: 'brands:read',
        },
        {
          to: '/admin/branches',
          label: t('nav.branches'),
          icon: <Store aria-hidden="true" />,
          permission: 'branches:read',
        },
        {
          to: '/admin/settings',
          label: t('nav.settings'),
          icon: <Settings aria-hidden="true" />,
          permission: 'settings:write',
        },
        {
          to: '/admin/audit',
          label: t('nav.audit'),
          icon: <ScrollText aria-hidden="true" />,
          permission: 'audit:read',
        },
      ],
    },
  ];

  const initials = (user?.name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join('')
    .toUpperCase();

  return (
    // A page that prints (a purchase order) puts its own print-only copy outside this.
    <div className="min-h-screen bg-canvas text-ink print:hidden lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      {/* The bar of a phone or a small tablet: the brand and the menu button. */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-white px-4 py-2.5 lg:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <BrandMark name={markName} logoUrl={brand.data?.logoUrl} size="sm" />
          <p className="truncate font-semibold">{markName}</p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="admin-sidebar"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex min-h-11 items-center gap-2 rounded-control border border-slate-300 bg-white px-3 text-sm font-semibold [&_svg]:size-5"
        >
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          {t('nav.open')}
        </button>
      </header>

      {open && (
        <div
          aria-hidden="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-ink/40 lg:hidden"
        />
      )}

      <aside
        id="admin-sidebar"
        className={`fixed inset-y-0 start-0 z-40 flex w-72 flex-col border-e border-line bg-white transition-transform lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-auto ${
          // Off screen only on a phone or small tablet; always in place from laptop width.
          open ? 'translate-x-0' : 'max-lg:-translate-x-full max-lg:rtl:translate-x-full'
        }`}
      >
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          <BrandMark name={markName} logoUrl={brand.data?.logoUrl} />
          <div className="min-w-0">
            <p className="truncate leading-tight font-bold">{markName}</p>
            <p className="truncate text-xs text-slate-500">{t('nav.backOffice')}</p>
          </div>
        </div>

        <nav aria-label={t('nav.label')} className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          {groups.map((group) => {
            const shown = group.entries.filter(
              (entry) => entry.permission === null || can(entry.permission),
            );
            if (shown.length === 0) return null;
            return (
              <div key={group.label} className="space-y-0.5">
                <p className="px-3 pb-1 text-[11px] font-bold tracking-[0.08em] text-slate-500 uppercase">
                  {group.label}
                </p>
                {shown.map((entry) => (
                  <NavLink
                    key={entry.to}
                    to={entry.to}
                    end={entry.end}
                    className={linkClass}
                    // A page opened from the menu on a phone closes the menu.
                    onClick={() => setOpen(false)}
                  >
                    {entry.icon}
                    {entry.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        {user && (
          <div className="space-y-3 border-t border-line p-4">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-600"
              >
                {initials}
              </span>
              <p className="min-w-0 text-sm leading-tight">
                <span className="block truncate font-semibold">{user.name}</span>
                <span className="block truncate text-xs text-slate-500">
                  {t(`roles.${user.role.key}`)}
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <LanguageSwitcher />
              <button
                type="button"
                onClick={() => void logout()}
                className="inline-flex min-h-11 items-center gap-2 rounded-control border border-slate-300 bg-white px-3 text-sm font-semibold hover:bg-slate-50 [&_svg]:size-[18px]"
              >
                <LogOut aria-hidden="true" />
                {t('auth.signOut')}
              </button>
            </div>
            {user.email && (
              <Link
                to="/change-password"
                className="inline-flex min-h-9 items-center gap-2 text-sm text-slate-600 underline underline-offset-2 hover:text-ink [&_svg]:size-4"
              >
                <KeyRound aria-hidden="true" />
                {t('auth.changePassword.link')}
              </Link>
            )}
          </div>
        )}
      </aside>

      <main className="office-main mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <Outlet />
      </main>
    </div>
  );
}
