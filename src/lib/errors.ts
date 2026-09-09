/**
 * Turns database and network errors into sentences a salesperson can act on.
 *
 * Requirement 37: never show "PostgrestError 23505" to a user. The technical
 * detail still goes to the browser console so it can be debugged.
 */

import { isDev } from './env';

interface ErrorLike {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
}

/** Postgres error codes we expect and can explain properly. */
const PG_CODES: Record<string, string> = {
  '23505': 'That record already exists.',
  '23503': 'That item is still linked to other records, so it cannot be removed.',
  '23514': 'Some of the information entered is not valid.',
  '22P02': 'Some of the information entered is in the wrong format.',
  '42501': 'You do not have permission to do that.',
  PGRST301: 'Your session has expired. Please sign in again.',
  PGRST116: 'That record could not be found.',
};

/** Custom errors our own database functions raise, keyed by their prefix. */
const APP_CODES: Array<[string, string]> = [
  ['NOT_ASSIGNED', 'This society is no longer assigned to you. Please refresh your list.'],
  ['FORBIDDEN', 'You do not have permission to do that.'],
  ['NOT_FOUND', 'That record could not be found. It may have been deleted.'],
  ['INVALID_BDM', 'That BDM is inactive or no longer exists.'],
  ['INVALID_FIELD', 'That filter is not supported.'],
];

export function friendlyError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (isDev) console.error('[pilot-prospector]', error);
  else console.error('[pilot-prospector]', (error as ErrorLike)?.message ?? error);

  if (!error) return fallback;

  const err = error as ErrorLike;
  const message = err.message ?? '';

  // Our own named errors from the SQL functions.
  for (const [code, text] of APP_CODES) {
    if (message.includes(code)) return text;
  }

  // The one-assignment-per-lead guarantee, hit head-on.
  if (message.includes('lead_assignments_one_active_idx')) {
    return 'This lead is already assigned to another BDM. Reassign it instead.';
  }
  if (message.includes('bdms_name_key')) {
    return 'A BDM with that name already exists. Please use a different name.';
  }
  if (message.includes('admins_username_key')) {
    return 'That username is already taken. Please choose another.';
  }

  if (err.code && PG_CODES[err.code]) return PG_CODES[err.code]!;

  // Network problems - very common for a BDM in a basement car park.
  if (
    message.includes('Failed to fetch') ||
    message.includes('NetworkError') ||
    message.includes('Load failed')
  ) {
    return 'Cannot reach the server. Check your internet connection and try again.';
  }

  if (err.status === 401 || err.status === 403) {
    return 'Your session has expired. Please sign in again.';
  }
  if (err.status === 429) {
    return 'Too many attempts. Please wait a minute and try again.';
  }
  if (err.status && err.status >= 500) {
    return 'The server is having trouble. Please try again in a moment.';
  }

  // A message we deliberately wrote to be user-facing already.
  if (message && message.length < 140 && !message.includes('{') && !/[A-Z]{4,}\d/.test(message)) {
    return message;
  }

  return fallback;
}

/** Thrown by the API helper so callers can react to the HTTP status. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}
