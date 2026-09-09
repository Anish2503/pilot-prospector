import { Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { env } from '@/lib/env';

/**
 * The app's own mark. Deliberately generic - swap in MyGate's official logo
 * whenever you have the asset file, by replacing the icon below with an <img>.
 */
export function Logo({
  size = 'md',
  showName = true,
  className,
  inverted = false,
}: {
  size?: 'sm' | 'md' | 'lg';
  showName?: boolean;
  className?: string;
  inverted?: boolean;
}) {
  const boxSizes = { sm: 'size-8 rounded-lg', md: 'size-10 rounded-xl', lg: 'size-14 rounded-2xl' };
  const iconSizes = { sm: 'size-4', md: 'size-5', lg: 'size-7' };
  const textSizes = { sm: 'text-sm', md: 'text-base', lg: 'text-xl' };

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div
        className={cn(
          'flex shrink-0 items-center justify-center shadow-sm',
          boxSizes[size],
          inverted ? 'bg-white text-brand-700' : 'bg-brand-600 text-white',
        )}
      >
        <Building2 className={iconSizes[size]} aria-hidden />
      </div>
      {showName && (
        <span
          className={cn(
            'font-semibold tracking-tight',
            textSizes[size],
            inverted ? 'text-white' : 'text-slate-900',
          )}
        >
          {env.appName}
        </span>
      )}
    </div>
  );
}
