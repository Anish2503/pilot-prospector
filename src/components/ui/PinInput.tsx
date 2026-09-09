import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

/**
 * Four large boxes for the BDM's PIN. Big targets, numeric keypad on phones,
 * and it moves between boxes on its own so there is nothing to think about.
 */
export function PinInput({
  value,
  onChange,
  onComplete,
  disabled,
  error,
  length = 4,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  error?: boolean;
  length?: number;
  autoFocus?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  const commit = (next: string) => {
    onChange(next);
    if (next.length === length) onComplete?.(next);
  };

  const handleInput = (index: number, raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return;

    // Typing or pasting several digits at once fills the boxes onward.
    const chars = value.split('');
    for (let i = 0; i < digits.length && index + i < length; i++) {
      chars[index + i] = digits[i]!;
    }
    const next = chars.join('').slice(0, length);
    commit(next);

    const focusAt = Math.min(index + digits.length, length - 1);
    refs.current[focusAt]?.focus();
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      const chars = value.split('');

      if (chars[index]) {
        chars[index] = '';
        commit(chars.join('').replace(/\s/g, ''));
      } else if (index > 0) {
        chars[index - 1] = '';
        commit(chars.join('').slice(0, index - 1));
        refs.current[index - 1]?.focus();
      }
      return;
    }

    if (event.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus();
    if (event.key === 'ArrowRight' && index < length - 1) refs.current[index + 1]?.focus();
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!digits) return;
    commit(digits);
    refs.current[Math.min(digits.length, length - 1)]?.focus();
  };

  return (
    <div className="flex justify-center gap-3" role="group" aria-label={`${length}-digit PIN`}>
      {Array.from({ length }).map((_, index) => (
        <input
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          disabled={disabled}
          autoFocus={autoFocus && index === 0}
          value={value[index] ?? ''}
          onChange={(e) => handleInput(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          aria-label={`PIN digit ${index + 1}`}
          className={cn(
            'size-14 rounded-xl border-2 bg-white text-center text-2xl font-semibold text-slate-900 transition',
            'focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 focus:outline-none',
            'disabled:bg-slate-50 disabled:text-slate-400',
            error ? 'border-red-400' : 'border-slate-300',
          )}
        />
      ))}
    </div>
  );
}
