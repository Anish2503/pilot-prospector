/**
 * Short confirmation and error messages that slide in at the corner.
 *
 * Used so that every action gives clear feedback - requirement 33.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, Info, X, AlertCircle, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastTone = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  title?: string;
}

interface ToastContextValue {
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
  warning: (message: string, title?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, { box: string; icon: ReactNode }> = {
  success: {
    box: 'bg-emerald-600 text-white',
    icon: <CheckCircle2 className="size-5 shrink-0" aria-hidden />,
  },
  error: {
    box: 'bg-red-600 text-white',
    icon: <AlertCircle className="size-5 shrink-0" aria-hidden />,
  },
  warning: {
    box: 'bg-amber-500 text-white',
    icon: <TriangleAlert className="size-5 shrink-0" aria-hidden />,
  },
  info: {
    box: 'bg-slate-800 text-white',
    icon: <Info className="size-5 shrink-0" aria-hidden />,
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string, title?: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-3), { id, tone, message, title }]);
      // Errors linger a little longer so they can actually be read.
      setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      success: (message, title) => push('success', message, title),
      error: (message, title) => push('error', message, title),
      info: (message, title) => push('info', message, title),
      warning: (message, title) => push('warning', message, title),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:items-end"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'animate-fade-in-up pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl px-4 py-3 shadow-lg',
              TONE_STYLES[toast.tone].box,
            )}
          >
            {TONE_STYLES[toast.tone].icon}
            <div className="min-w-0 flex-1 text-sm">
              {toast.title && <p className="font-semibold">{toast.title}</p>}
              <p className={cn(toast.title && 'opacity-90')}>{toast.message}</p>
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              className="-m-1 shrink-0 rounded p-1 opacity-70 transition hover:opacity-100"
              aria-label="Dismiss"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
