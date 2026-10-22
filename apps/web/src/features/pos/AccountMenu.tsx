import { ChevronDown, Clock3, LayoutDashboard, LogOut } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '../auth/auth-context';

interface AccountMenuProps {
  // When the shift opened, shown in the menu.
  shiftSince: string;
  onCloseShift: () => void;
}

const itemBase =
  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start text-sm font-medium hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none [&_svg]:size-[18px] [&_svg]:shrink-0';
const itemClass = `${itemBase} text-ink [&_svg]:text-slate-500`;

// The cashier's name on the till, and behind it what a cashier needs rarely: closing the shift,
// the back office (for a manager), signing out. It keeps the header to the everyday buttons.
export function AccountMenu({ shiftSince, onCloseShift }: AccountMenuProps) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const name = user?.name ?? '';
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join('')
    .toUpperCase();
  const manager = user?.permissions.includes('branches:read') ?? false;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t('pos.account.open', { name })}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 items-center gap-2.5 rounded-control border border-slate-300 bg-white py-1 ps-1 pe-2.5 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-ink/25 focus-visible:outline-none"
      >
        <span
          aria-hidden="true"
          className="grid size-9 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-600"
        >
          {initials}
        </span>
        <span className="hidden text-start leading-tight sm:block">
          <span className="block text-sm font-semibold">{name}</span>
          <span className="block text-xs text-slate-500">
            {user ? t(`roles.${user.role.key}`) : ''}
          </span>
        </span>
        <ChevronDown aria-hidden="true" className="size-4 text-slate-500" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={t('pos.account.label')}
          className="absolute end-0 z-40 mt-2 w-64 rounded-card border border-line bg-white p-1.5 shadow-float"
        >
          <p className="px-3 pt-2 pb-1 text-xs text-slate-500">{shiftSince}</p>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              setOpen(false);
              onCloseShift();
            }}
          >
            <Clock3 aria-hidden="true" />
            {t('pos.shift.close')}
          </button>
          {manager && (
            <Link to="/admin" role="menuitem" className={itemClass}>
              <LayoutDashboard aria-hidden="true" />
              {t('auth.backOffice')}
            </Link>
          )}
          <div className="my-1 border-t border-line" />
          <button
            type="button"
            role="menuitem"
            className={`${itemBase} text-danger`}
            onClick={() => void logout()}
          >
            <LogOut aria-hidden="true" />
            {t('auth.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}
