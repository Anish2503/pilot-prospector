/**
 * Talks to our own server code in netlify/functions.
 *
 * Anything that needs a secret key - checking a password, hashing a PIN,
 * importing a spreadsheet, geocoding an address - happens there, not here.
 */

import { ApiError } from './errors';
import { getSession } from './session';

const BASE = '/api';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Skip attaching the login pass (used by the login call itself). */
  anonymous?: boolean;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, anonymous } = options;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (!anonymous) {
    const session = getSession();
    if (session) headers.Authorization = `Bearer ${session.token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    if ((cause as Error)?.name === 'AbortError') throw cause;
    throw new ApiError(
      'Cannot reach the server. Check your internet connection and try again.',
      0,
    );
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }

  if (!response.ok) {
    const message =
      (payload as { error?: string } | null)?.error ??
      `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { signal }),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
    apiRequest<T>(path, { method: 'POST', body, signal }),
  postAnonymous: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: 'POST', body, anonymous: true }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};
