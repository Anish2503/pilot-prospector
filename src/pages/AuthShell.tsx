import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/Brand';

/** The shared frame for the login and setup screens. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  backTo = '/',
  backLabel = 'Back',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  backTo?: string | null;
  backLabel?: string;
}) {
  return (
    <main className="flex min-h-screen flex-col bg-slate-50">
      <header className="flex items-center justify-between px-5 py-5 sm:px-8">
        <Logo size="sm" />
        {backTo && (
          <Link
            to={backTo}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-200/60 hover:text-slate-900"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {backLabel}
          </Link>
        )}
      </header>

      <div className="flex flex-1 items-center justify-center px-5 pb-16">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
            {subtitle && (
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{subtitle}</p>
            )}
          </div>

          <div className="card p-6 sm:p-7">{children}</div>

          {footer && <div className="mt-5 text-center text-sm text-slate-500">{footer}</div>}
        </div>
      </div>
    </main>
  );
}
