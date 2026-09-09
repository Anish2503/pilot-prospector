import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, TriangleAlert } from 'lucide-react';
import { cn, STATUS_CLASSES, STATUS_LABELS } from '@/lib/utils';
import type { LeadStatus } from '@/types';

// -----------------------------------------------------------------------------

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-brand-600', className)} aria-hidden />;
}

export function LoadingBlock({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
      <Spinner className="size-7" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

/** Grey placeholder blocks shown while real content loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-200', className)} />;
}

// -----------------------------------------------------------------------------

type AlertTone = 'info' | 'success' | 'warning' | 'error';

const ALERT_STYLES: Record<AlertTone, { box: string; icon: ReactNode }> = {
  info: {
    box: 'bg-blue-50 text-blue-900 border-blue-200',
    icon: <Info className="size-5 shrink-0 text-blue-600" aria-hidden />,
  },
  success: {
    box: 'bg-emerald-50 text-emerald-900 border-emerald-200',
    icon: <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-hidden />,
  },
  warning: {
    box: 'bg-amber-50 text-amber-900 border-amber-200',
    icon: <TriangleAlert className="size-5 shrink-0 text-amber-600" aria-hidden />,
  },
  error: {
    box: 'bg-red-50 text-red-900 border-red-200',
    icon: <AlertCircle className="size-5 shrink-0 text-red-600" aria-hidden />,
  },
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
  action,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  const style = ALERT_STYLES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-lg border p-3.5 text-sm', style.box, className)}
    >
      {style.icon}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'leading-relaxed')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

// -----------------------------------------------------------------------------

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}>
      {icon && (
        <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-slate-500">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// -----------------------------------------------------------------------------

export function StatusBadge({ status, className }: { status: LeadStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        STATUS_CLASSES[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function Badge({
  children,
  tone = 'slate',
  className,
}: {
  children: ReactNode;
  tone?: 'slate' | 'brand' | 'emerald' | 'amber' | 'red' | 'violet';
  className?: string;
}) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700 ring-slate-200',
    brand: 'bg-brand-50 text-brand-700 ring-brand-200',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-800 ring-amber-200',
    red: 'bg-red-50 text-red-700 ring-red-200',
    violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Marks a value the system worked out for itself rather than one a human
 * confirmed. Requirement 10: enriched data must never look like certain fact.
 */
export function ConfidenceTag({
  source,
  confidence,
}: {
  source: string;
  confidence?: string;
}) {
  if (source === 'uploaded') return <Badge tone="slate">From spreadsheet</Badge>;
  if (source === 'google_maps_url') return <Badge tone="emerald">From Google Maps link</Badge>;
  if (source === 'google_maps_redirect') {
    return <Badge tone="emerald">From Google Maps link (followed)</Badge>;
  }
  if (source === 'manual') return <Badge tone="emerald">Confirmed by admin</Badge>;
  if (source === 'bdm_visit') return <Badge tone="emerald">Confirmed on site</Badge>;
  if (source === 'geocoded') {
    return (
      <Badge tone="amber">
        Estimated{confidence && confidence !== 'unverified' ? ` (${confidence})` : ''} - needs
        checking
      </Badge>
    );
  }
  return <Badge tone="amber">Needs verification</Badge>;
}
