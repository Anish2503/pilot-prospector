import { Link } from 'react-router-dom';
import { ArrowRight, MapPin, ShieldCheck, Users } from 'lucide-react';
import { Logo } from '@/components/Brand';
import { env } from '@/lib/env';

/**
 * The very first screen. Two clear ways in - nothing else to think about.
 */
export default function LandingPage() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-slate-950">
      {/* Soft background wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,theme(colors.brand.700/45%),transparent_60%),radial-gradient(ellipse_at_bottom_right,theme(colors.brand.900/60%),transparent_55%)]"
      />

      <header className="relative z-10 px-6 py-6 sm:px-10">
        <Logo size="md" inverted />
      </header>

      <div className="relative z-10 flex flex-1 items-center justify-center px-5 py-8 sm:px-10">
        <div className="w-full max-w-4xl">
          {/* ------------------------------------------------------- Intro */}
          <div className="mb-10 text-center sm:mb-12">
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Field prospecting, organised.
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-slate-300">
              Assign societies to your Business Development Managers, track every visit, and see
              the whole pipeline in one place.
            </p>
          </div>

          {/* ------------------------------------------------- Two entrances */}
          <div className="grid gap-4 sm:grid-cols-2">
            <EntranceCard
              to="/login/admin"
              icon={<ShieldCheck className="size-6" />}
              title="Login as Admin"
              description="Upload leads, assign societies, and view team analytics."
            />
            <EntranceCard
              to="/login/bdm"
              icon={<MapPin className="size-6" />}
              title="Login as BDM"
              description="See your assigned societies sorted by how near they are."
            />
          </div>

          {/* --------------------------------------------------- Reassurance */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 text-sm text-slate-400">
            <span className="inline-flex items-center gap-2">
              <Users className="size-4" aria-hidden />
              Built for field teams
            </span>
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="size-4" aria-hidden />
              Your data stays private to your team
            </span>
          </div>
        </div>
      </div>

      <footer className="relative z-10 px-6 py-6 text-center text-xs text-slate-500 sm:px-10">
        {env.appName} &middot; Internal tool
      </footer>
    </main>
  );
}

function EntranceCard({
  to,
  icon,
  title,
  description,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="group relative flex flex-col rounded-2xl border border-white/10 bg-white/5 p-6 text-left backdrop-blur-sm transition hover:border-white/25 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white sm:p-7"
    >
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-brand-600 text-white shadow-lg shadow-brand-950/40 transition group-hover:scale-105">
        {icon}
      </div>

      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed text-slate-300">{description}</p>

      <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-brand-300 transition group-hover:gap-2.5 group-hover:text-brand-200">
        Continue
        <ArrowRight className="size-4" aria-hidden />
      </span>
    </Link>
  );
}
