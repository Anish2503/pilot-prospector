/**
 * Who is signed in, app-wide.
 *
 * Logging in calls our server, which verifies the password or PIN and returns
 * a signed pass. We keep the pass; we never keep the password.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';
import { clearSession, getSession, onSessionChange, setSession } from './session';
import type { BdmOption, Session } from '@/types';

interface LoginResponse {
  token: string;
  role: Session['role'];
  id: string;
  name: string;
  username?: string;
  expiresAt: number;
}

interface AuthContextValue {
  session: Session | null;
  isAdmin: boolean;
  isBdm: boolean;
  loading: boolean;
  loginAdmin: (username: string, password: string) => Promise<void>;
  loginBdm: (bdmId: string, pin: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setLocalSession] = useState<Session | null>(() => getSession());
  const [loading, setLoading] = useState(false);

  // Keep React in step with logouts triggered elsewhere (another tab, or an
  // expired pass detected during a request).
  useEffect(() => onSessionChange(setLocalSession), []);

  const loginAdmin = useCallback(async (username: string, password: string) => {
    setLoading(true);
    try {
      const result = await api.postAnonymous<LoginResponse>('/auth-login', {
        mode: 'admin',
        username: username.trim(),
        password,
      });
      setSession(result);
    } finally {
      setLoading(false);
    }
  }, []);

  const loginBdm = useCallback(async (bdmId: string, pin: string) => {
    setLoading(true);
    try {
      const result = await api.postAnonymous<LoginResponse>('/auth-login', {
        mode: 'bdm',
        bdmId,
        pin,
      });
      setSession(result);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    clearSession();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isAdmin: session?.role === 'super_admin',
      isBdm: session?.role === 'bdm',
      loading,
      loginAdmin,
      loginBdm,
      logout,
    }),
    [session, loading, loginAdmin, loginBdm, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/**
 * The BDM login dropdown list.
 *
 * This comes from the server rather than straight from the database, because
 * the `bdms` table is locked to signed-in users only. The server returns just
 * ids and names - never PINs, never phone numbers.
 */
export function fetchBdmOptions(): Promise<{ bdms: BdmOption[] }> {
  return api.postAnonymous<{ bdms: BdmOption[] }>('/auth-login', { mode: 'list-bdms' });
}
