/**
 * The browser-side settings.
 *
 * IMPORTANT: nothing in this file throws while it is being imported.
 *
 * It used to, and that was a mistake: a module-level throw happens before React
 * has started, so the whole page stayed blank with the real reason buried in
 * the browser console. Now a missing setting is reported as data, and App.tsx
 * renders a screen that says exactly what to fix.
 *
 * Only VITE_ variables exist here. Secrets never reach this file - they live in
 * netlify/functions, which run on Netlify's servers.
 */

interface Missing {
  name: string;
  reason: 'missing' | 'placeholder';
}

const missing: Missing[] = [];

function read(name: string, raw: string | undefined): string {
  const value = raw?.trim() ?? '';

  if (!value) {
    missing.push({ name, reason: 'missing' });
    return '';
  }
  // Catches a .env copied but never filled in.
  if (value.startsWith('PASTE_') || value.startsWith('your-')) {
    missing.push({ name, reason: 'placeholder' });
    return '';
  }
  return value;
}

const supabaseUrl = read('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL);
const supabaseAnonKey = read('VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY);

export const env = {
  // The fallback keeps the Supabase client constructor happy. It is never used
  // for a real request, because App.tsx refuses to render the app when
  // configError is set.
  supabaseUrl: supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey: supabaseAnonKey || 'placeholder-key',
  appName: import.meta.env.VITE_APP_NAME?.trim() || 'Pilot Prospector',
};

/** The names of any settings that are missing or still placeholders. */
export const missingSettings: string[] = missing.map((m) => m.name);

/** Null when everything is configured; otherwise a short explanation. */
export const configError: string | null =
  missing.length === 0
    ? null
    : `Missing ${missing.length === 1 ? 'setting' : 'settings'}: ${missingSettings.join(', ')}`;

/** True when the app is running locally via `npm run dev`. */
export const isDev = import.meta.env.DEV;
