import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import type { AppRole } from '@/types';

/**
 * Blocks a page unless the visitor holds the right kind of pass.
 *
 * This is a convenience for the user, NOT the security boundary. The real
 * protection is in the database (Row Level Security). Even if someone bypassed
 * this component entirely, every query would still come back empty.
 */
export function ProtectedRoute({ allow }: { allow: AppRole }) {
  const { session } = useAuth();
  const location = useLocation();

  if (!session) {
    const loginPath = allow === 'super_admin' ? '/login/admin' : '/login/bdm';
    return <Navigate to={loginPath} replace state={{ from: location.pathname }} />;
  }

  // Signed in, but as the wrong kind of user - send them to their own home.
  if (session.role !== allow) {
    return <Navigate to={session.role === 'super_admin' ? '/admin' : '/bdm'} replace />;
  }

  return <Outlet />;
}

/** Bounces an already-signed-in user away from the login screens. */
export function RedirectIfSignedIn({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  if (session) {
    return <Navigate to={session.role === 'super_admin' ? '/admin' : '/bdm'} replace />;
  }
  return <>{children}</>;
}
