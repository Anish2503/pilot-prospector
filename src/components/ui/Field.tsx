import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

interface FieldShellProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

function FieldShell({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className,
}: FieldShellProps) {
  return (
    <div className={cn('w-full', className)}>
      {label && (
        <label htmlFor={htmlFor} className="label-base">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1.5 text-sm text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-sm text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
  containerClassName?: string;
}

export function Input({
  label,
  hint,
  error,
  leftIcon,
  rightSlot,
  className,
  containerClassName,
  id,
  required,
  ...props
}: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;

  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={required}
      htmlFor={inputId}
      className={containerClassName}
    >
      <div className="relative">
        {leftIcon && (
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400">
            {leftIcon}
          </span>
        )}
        <input
          id={inputId}
          className={cn(
            'input-base',
            leftIcon && 'pl-10',
            rightSlot && 'pr-10',
            error && 'border-red-400 focus:border-red-500 focus:ring-red-500/20',
            className,
          )}
          aria-invalid={error ? true : undefined}
          required={required}
          {...props}
        />
        {rightSlot && (
          <span className="absolute top-1/2 right-2 -translate-y-1/2">{rightSlot}</span>
        )}
      </div>
    </FieldShell>
  );
}

// -----------------------------------------------------------------------------

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  placeholder?: string;
  options: Array<{ value: string; label: string }>;
  containerClassName?: string;
}

export function Select({
  label,
  hint,
  error,
  placeholder,
  options,
  className,
  containerClassName,
  id,
  required,
  ...props
}: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;

  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={required}
      htmlFor={selectId}
      className={containerClassName}
    >
      <select
        id={selectId}
        className={cn(
          'input-base appearance-none bg-[length:1.25rem] bg-[right_0.6rem_center] bg-no-repeat pr-10',
          "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='2' stroke='%2394a3b8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='m19.5 8.25-7.5 7.5-7.5-7.5'/%3E%3C/svg%3E\")]",
          error && 'border-red-400 focus:border-red-500 focus:ring-red-500/20',
          className,
        )}
        aria-invalid={error ? true : undefined}
        required={required}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

// -----------------------------------------------------------------------------

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
}

export function Textarea({
  label,
  hint,
  error,
  className,
  containerClassName,
  id,
  required,
  rows = 4,
  ...props
}: TextareaProps) {
  const autoId = useId();
  const areaId = id ?? autoId;

  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={required}
      htmlFor={areaId}
      className={containerClassName}
    >
      <textarea
        id={areaId}
        rows={rows}
        className={cn(
          'input-base resize-y',
          error && 'border-red-400 focus:border-red-500 focus:ring-red-500/20',
          className,
        )}
        aria-invalid={error ? true : undefined}
        required={required}
        {...props}
      />
    </FieldShell>
  );
}
