import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeNumberInput } from '../../lib/numbers';

export interface StaffPin {
  staffCode: string;
  pin: string;
}

export const emptyStaffPin: StaffPin = { staffCode: '', pin: '' };

type Field = keyof StaffPin;

const MAX_LENGTH: Record<Field, number> = { staffCode: 32, pin: 6 };

const fieldClass =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-center text-xl tracking-widest focus:ring-2 focus:ring-slate-400 focus:outline-none disabled:bg-slate-100';

const keyClass =
  'rounded-lg border border-slate-200 bg-white py-4 text-xl font-semibold text-slate-900 hover:bg-slate-100 focus:ring-2 focus:ring-slate-400 focus:outline-none active:bg-slate-200 disabled:opacity-50';

interface StaffPinFieldsProps {
  value: StaffPin;
  onChange: (value: StaffPin) => void;
  disabled?: boolean;
}

// A staff code, a PIN and a number pad for a touch screen. The pad types into the field that last
// had the focus; a keyboard works too. Digits typed on an Arabic keyboard become plain digits.
// See docs/specs/006-pos-terminal.md, rule 2.
export function StaffPinFields({ value, onChange, disabled = false }: StaffPinFieldsProps) {
  const { t } = useTranslation();
  const id = useId();
  const [active, setActive] = useState<Field>('staffCode');
  const inputs = { staffCode: useRef<HTMLInputElement>(null), pin: useRef<HTMLInputElement>(null) };

  const set = (field: Field, text: string) =>
    onChange({ ...value, [field]: normalizeNumberInput(text).slice(0, MAX_LENGTH[field]) });

  function press(key: string) {
    const current = value[active];
    if (key === 'back') set(active, current.slice(0, -1));
    else if (key === 'clear') set(active, '');
    else set(active, current + key);
  }

  const field = (name: Field, label: string, type: 'text' | 'password') => (
    <div>
      <label htmlFor={`${id}-${name}`} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        ref={inputs[name]}
        id={`${id}-${name}`}
        type={type}
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        disabled={disabled}
        value={value[name]}
        onFocus={() => setActive(name)}
        onChange={(event) => set(name, event.target.value)}
        className={fieldClass}
      />
    </div>
  );

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {field('staffCode', t('pos.signIn.staffCode'), 'text')}
        {field('pin', t('pos.signIn.pin'), 'password')}
      </div>
      <div className="grid grid-cols-3 gap-2" dir="ltr">
        {keys.map((key) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            // The field keeps the focus, so a screen keyboard does not pop up and down.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              press(key);
              inputs[active].current?.focus();
            }}
            aria-label={
              key === 'back'
                ? t('pos.signIn.backspace')
                : key === 'clear'
                  ? t('pos.signIn.clear')
                  : undefined
            }
            className={keyClass}
          >
            {key === 'back' ? '⌫' : key === 'clear' ? 'C' : key}
          </button>
        ))}
      </div>
    </div>
  );
}
