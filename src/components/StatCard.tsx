import type { LucideIcon } from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';
import { Skeleton } from '@/components/ui/Feedback';

type Tone = 'brand' | 'emerald' | 'amber' | 'slate' | 'violet' | 'red';

const TONES: Record<Tone, string> = {
  brand: 'bg-brand-50 text-brand-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  slate: 'bg-slate-100 text-slate-500',
  violet: 'bg-violet-50 text-violet-600',
  red: 'bg-red-50 text-red-600',
};

export function StatCard({
  label,
  value,
  sublabel,
  icon: Icon,
  tone = 'brand',
  loading = false,
  onClick,
}: {
  label: string;
  value: number | string | null | undefined;
  sublabel?: string;
  icon?: LucideIcon;
  tone?: Tone;
  loading?: boolean;
  onClick?: () => void;
}) {
  const display = typeof value === 'number' ? formatNumber(value) : (value ?? '-');
  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      onClick={onClick}
      className={cn(
        'card flex items-start gap-3 p-4 text-left',
        onClick && 'transition hover:border-brand-300 hover:shadow-md',
      )}
    >
      {Icon && (
        <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', TONES[tone])}>
          <Icon className="size-5" aria-hidden />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-slate-500">{label}</p>
        {loading ? (
          <Skeleton className="mt-1.5 h-7 w-16" />
        ) : (
          <p className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
            {display}
          </p>
        )}
        {sublabel && !loading && <p className="mt-0.5 truncate text-xs text-slate-400">{sublabel}</p>}
      </div>
    </Wrapper>
  );
}
