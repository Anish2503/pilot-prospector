import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ListChecks, LogOut, Map, type LucideIcon } from 'lucide-react';
import { Logo } from '@/components/Brand';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { useAuth } from '@/lib/auth';
import { cn, initials } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

/** Grows as each BDM screen is built. */
export const BDM_NAV: NavItem[] = [
  { to: '/bdm', label: 'My Leads', icon: ListChecks, end: true },
  { to: '/bdm/map', label: 'Map', icon: Map },
];

/**
 * Phone-first: a compact header, and a thumb-reachable bar along the bottom
 * once there is more than one screen to move between.
 */
export default function BdmLayout() {
  const { session, logout } = useAuth();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const showTabBar = BDM_NAV.length > 1;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Logo size="sm" showName={false} />

          <div className="min-w-0 flex-1 px-3">
            <p className="truncate text-sm font-semibold text-slate-900">
              {session?.name ?? 'BDM'}
            </p>
            <p className="text-xs text-slate-500">Business Development Manager</p>
          </div>

          <div className="flex items-center gap-1">
            <div className="flex size-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
              {initials(session?.name ?? '') || 'B'}
            </div>
            <button
              onClick={() => setConfirmLogout(true)}
              className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              aria-label="Sign out"
            >
              <LogOut className="size-[18px]" />
            </button>
          </div>
        </div>
      </header>

      <main className={cn('mx-auto w-full max-w-3xl flex-1 px-4 py-4', showTabBar && 'pb-24')}>
        <Outlet />
      </main>

      {showTabBar && (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
          <ul className="mx-auto flex max-w-3xl">
            {BDM_NAV.map(({ to, label, icon: Icon, end }) => (
              <li key={to} className="flex-1">
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cn(
                      'flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium transition',
                      isActive ? 'text-brand-700' : 'text-slate-500 hover:text-slate-800',
                    )
                  }
                >
                  <Icon className="size-5" aria-hidden />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <ConfirmDialog
        open={confirmLogout}
        onCancel={() => setConfirmLogout(false)}
        onConfirm={logout}
        title="Sign out?"
        message="You will need to select your name and enter your PIN again."
        confirmLabel="Sign out"
        tone="danger"
      />
    </div>
  );
}
