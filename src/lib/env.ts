/**
 * Reads the browser-side environment variables and fails loudly if they are
 * missing, so a misconfigured deployment shows a clear message instead of a
 * confusing blank screen.
 *
 * Only VITE_ variables exist here. Secrets never reach this file - they live
 * in netlify/functions, which run on Netlify's servers.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '' || value.startsWith('your-')) {
    throw new Error(
      `Missing configuration: ${name}. ` +
        `Copy .env.example to .env and fill in the value, or add it in ` +
        `Netlify under Site configuration -> Environment variables.`,
    );
  }
  return value.trim();
}

export const env = {
  supabaseUrl: required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL),
  supabaseAnonKey: required(
    'VITE_SUPABASE_ANON_KEY',
    import.meta.env.VITE_SUPABASE_ANON_KEY,
  ),
  appName: import.meta.env.VITE_APP_NAME?.trim() || 'Pilot Prospector',
};

/** True when the app is running locally via `npm run dev`. */
export const isDev = import.meta.env.DEV;
