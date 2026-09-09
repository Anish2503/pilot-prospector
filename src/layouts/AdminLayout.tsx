import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Building2,
  LayoutDashboard,
  Map,
  MapPinned,
  LogOut,
  Menu,
  ShieldCheck,
  Upload,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from '@/components/Brand';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { useAuth } from '@/lib/auth';
import { cn, initials } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

/** Grows as each section of the admin area is built. */
export const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/leads', label: 'Leads', icon: Building2 },
  { to: '/admin/map', label: 'Map', icon: Map },
  { to: '/admin/upload', label: 'Upload Leads', icon: Upload },
  { to: '/admin/locations', label: 'Locations', icon: MapPinned },
  { to: '/admin/bdms', label: 'BDMs', icon: Users },
  { to: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/admin/activity', label: 'Activity', icon: Activity },
  { to: '/admin/admins', label: 'Admin Management', icon: ShieldCheck },
];

export default function AdminLayout() {
  const { session, logout } = useAuth();
  const location = useLocation();

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  // Changing page on a phone should close the menu behind you.
  useEffect(() => setMobileNavOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ------------------------------------------------- Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-16 items-center border-b border-slate-200 px-5">
          <Logo size="sm" />
        </div>
        <NavLinks className="flex-1 overflow-y-auto p-3" />
        <UserFooter name={session?.name ?? ''} onLogout={() => setConfirmLogout(true)} />
      </aside>

      {/* ------------------------------------------------------ Mobile bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden">
        <Logo size="sm" />
        <button
          onClick={() => setMobileNavOpen(true)}
          className="-mr-2 rounded-lg p-2 text-slate-600 transition hover:bg-slate-100"
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </button>
      </header>

      {/* --------------------------------------------------- Mobile drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/50"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden
          />
          <nav className="animate-fade-in-up absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-white shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
              <Logo size="sm" />
              <button
                onClick={() => setMobileNavOpen(false)}
                className="-mr-2 rounded-lg p-2 text-slate-500 transition hover:bg-slate-100"
                aria-label="Close menu"
              >
                <X className="size-5" />
              </button>
            </div>
            <NavLinks className="flex-1 overflow-y-auto p-3" />
            <UserFooter name={session?.name ?? ''} onLogout={() => setConfirmLogout(true)} />
          </nav>
        </div>
      )}

      {/* ---------------------------------------------------------- Content */}
      <div className="lg:pl-60">
        <main className="mx-auto max-w-[1600px] p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>

      <ConfirmDialog
        open={confirmLogout}
        onCancel={() => setConfirmLogout(false)}
        onConfirm={logout}
        title="Sign out?"
        message="You will need your username and password to sign back in."
        confirmLabel="Sign out"
        tone="danger"
      />
    </div>
  );
}

function NavLinks({ className }: { className?: string }) {
  return (
    <nav className={className}>
      <ul className="space-y-0.5">
        {ADMIN_NAV.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )
              }
            >
              <Icon className="size-[18px] shrink-0" aria-hidden />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function UserFooter({ name, onLogout }: { name: string; onLogout: () => void }) {
  return (
    <div className="border-t border-slate-200 p-3">
      <div className="flex items-center gap-3 rounded-lg px-2 py-2">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
          {initials(name) || 'A'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">{name}</p>
          <p className="text-xs text-slate-500">Super Admin</p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        fullWidth
        className="mt-1 justify-start"
        icon={<LogOut className="size-4" />}
        onClick={onLogout}
      >
        Sign out
      </Button>
    </div>
  );
}
