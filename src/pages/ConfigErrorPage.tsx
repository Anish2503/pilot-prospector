import { AlertTriangle } from 'lucide-react';
import { missingSettings } from '@/lib/env';

/**
 * Shown instead of the app when a required setting is missing.
 *
 * The point of this screen is that nobody should ever see a blank page and have
 * to guess. It names the exact variables and where to put them.
 */
export default function ConfigErrorPage() {
  const isLocal =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
      <div className="card w-full max-w-xl p-7">
        <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <AlertTriangle className="size-6" />
        </div>

        <h1 className="text-lg font-semibold text-slate-900">The app is not configured yet</h1>

        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          It cannot reach the database because {missingSettings.length === 1 ? 'a setting is' : 'some settings are'}{' '}
          missing. Nothing is broken — {missingSettings.length === 1 ? 'it' : 'they'} just{' '}
          {missingSettings.length === 1 ? 'needs' : 'need'} to be filled in.
        </p>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
            {missingSettings.length === 1 ? 'Missing setting' : 'Missing settings'}
          </p>
          <ul className="space-y-1">
            {missingSettings.map((name) => (
              <li key={name} className="font-mono text-sm text-red-700">
                {name}
              </li>
            ))}
          </ul>
        </div>

        {isLocal ? (
          <ol className="mt-5 space-y-2 text-sm text-slate-700">
            <li>
              <strong>1.</strong> Open the <code className="font-mono text-xs">.env</code> file in
              the project folder.
            </li>
            <li>
              <strong>2.</strong> Fill in the values shown above, using{' '}
              <code className="font-mono text-xs">docs/01-SUPABASE-SETUP.md</code>.
            </li>
            <li>
              <strong>3.</strong> Stop the server in the terminal (<strong>Ctrl+C</strong>) and run{' '}
              <code className="font-mono text-xs">npm run dev</code> again — settings are only read
              at start-up.
            </li>
          </ol>
        ) : (
          <ol className="mt-5 space-y-2 text-sm text-slate-700">
            <li>
              <strong>1.</strong> In Netlify, go to <strong>Site configuration → Environment
              variables</strong>.
            </li>
            <li>
              <strong>2.</strong> Add the {missingSettings.length === 1 ? 'variable' : 'variables'}{' '}
              listed above, copying the {missingSettings.length === 1 ? 'value' : 'values'} from
              your local <code className="font-mono text-xs">.env</code> file.
            </li>
            <li>
              <strong>3.</strong> Go to <strong>Deploys → Trigger deploy → Clear cache and deploy
              site</strong>.
              <span className="mt-1 block text-slate-500">
                This last step matters: these settings are baked in when the site is built, so
                adding them afterwards has no effect until you rebuild.
              </span>
            </li>
          </ol>
        )}
      </div>
    </main>
  );
}
