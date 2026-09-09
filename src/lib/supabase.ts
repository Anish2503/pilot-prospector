/**
 * The database connection used by the browser.
 *
 * The `anon` key below is public by design - it identifies the project, it does
 * not grant access. Access is decided by the signed pass we attach to every
 * request and the Row Level Security rules in supabase/migrations/002.
 */

import { createClient } from '@supabase/supabase-js';
import { env } from './env';
import { getSession } from './session';

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  // We issue our own passes from netlify/functions/auth-login, because Supabase's
  // built-in login requires an email address and the brief calls for
  // username+password for admins and name+PIN for BDMs.
  accessToken: async () => getSession()?.token ?? null,

  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },

  global: {
    headers: { 'x-application-name': 'pilot-prospector' },
  },

  db: { schema: 'public' },
});
