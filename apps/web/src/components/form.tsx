import type { ReactNode } from 'react';

export const fieldClass =
  'mt-1 block min-h-11 w-full rounded-control border border-slate-300 bg-white px-3 py-2 text-start shadow-xs transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-ink focus:ring-2 focus:ring-ink/15 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/20';

// For a control that shares a line with others. fieldClass is a whole row.
export const compactFieldClass =
  'min-h-11 rounded-control border border-slate-300 bg-white px-3 py-2 text-start shadow-xs transition-colors hover:border-slate-400 focus:border-ink focus:ring-2 focus:ring-ink/15 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500 aria-[invalid=true]:border-danger';

// The buttons of the design system: one primary action per screen, the rest quieter. Each is at
// least 44 px tall, a comfortable touch target, and takes an icon before its label.
const buttonBase =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 py-2 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-[18px] [&_svg]:shrink-0';

export const primaryButtonClass = `${buttonBase} bg-ink text-white shadow-xs hover:bg-slate-700 focus-visible:ring-ink/40`;

export const secondaryButtonClass = `${buttonBase} border border-slate-300 bg-white text-ink shadow-xs hover:border-slate-400 hover:bg-slate-50 focus-visible:ring-ink/25`;

// Money in: the Charge button and the payment's confirm.
export const moneyButtonClass = `${buttonBase} bg-money text-white shadow-xs hover:bg-money-strong focus-visible:ring-money/40`;

// Void, refund, remove: red, and always with a word that says what happens.
export const dangerButtonClass = `${buttonBase} border border-danger/30 bg-white text-danger hover:bg-danger-soft focus-visible:ring-danger/30`;

// A quiet button for a toolbar, often icon and short label.
export const ghostButtonClass = `${buttonBase} px-3 text-slate-700 hover:bg-slate-100 focus-visible:ring-ink/25`;

// A small status pill: Paid, Voided, Late, In use.
export const chipClass =
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold [&_svg]:size-3.5';

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
