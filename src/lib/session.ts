/**
 * Where the login "pass" is kept between page loads.
 *
 * WHAT IS STORED: only the signed token the server issued, plus the person's
 * name and role for display. NO password, NO PIN, and nothing the user could
 * usefully tamper with - the token is signed, so editing it makes it invalid
 * and the database will simply refuse every request.
 */

import type { Session } from '@/types';

const STORAGE_KEY = 'pp.session.v1';

/** Fired whenever the session changes, so every open tab stays in step. */
const listeners = new Set<(session: Session | null) => void>();

let cached: Session | null | undefined;

function read(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.token || !parsed?.role || !parsed?.id) return null;

    // An expired pass is treated as no pass at all.
    if (typeof parsed.expiresAt === 'number' && parsed.expiresAt * 1000 < Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getSession(): Session | null {
  if (cached === undefined) cached = read();
  return cached;
}

export function setSession(session: Session | null): void {
  cached = session;
  try {
    if (session) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Private browsing can block storage. The session still works for this
    // tab via the in-memory cache; the user just has to log in again later.
  }
  listeners.forEach((fn) => fn(session));
}

export function clearSession(): void {
  setSession(null);
}

export function onSessionChange(fn: (session: Session | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Keeps other browser tabs in step when someone logs out in one of them. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    cached = read();
    listeners.forEach((fn) => fn(cached ?? null));
  });
}

/** Seconds until the pass expires; negative once it already has. */
export function secondsUntilExpiry(session: Session): number {
  return session.expiresAt - Math.floor(Date.now() / 1000);
}
