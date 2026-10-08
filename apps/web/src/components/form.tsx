import type { ReactNode } from 'react';

export const fieldClass =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-start focus:ring-2 focus:ring-slate-400 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500';

export const primaryButtonClass =
  'rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:outline-none disabled:opacity-60';

export const secondaryButtonClass =
  'rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:ring-2 focus:ring-slate-400 focus:outline-none disabled:opacity-60';

// The attributes that tie an input to its hint and its error, for screen readers.
export function fieldAttributes(id: string, options: { hint?: boolean; error?: boolean }) {
  const described = [options.hint ? `${id}-hint` : '', options.error ? `${id}-error` : '']
    .filter(Boolean)
    .join(' ');
  return {
    id,
    'aria-invalid': options.error ? true : undefined,
    'aria-describedby': described || undefined,
  };
}

interface FormFieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  children: ReactNode;
}

// A label, the input passed as children, then a hint and an error message.
export function FormField({ id, label, hint, error, children }: FormFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
