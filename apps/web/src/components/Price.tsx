import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeNumberInput } from '../lib/numbers';
import { fieldClass } from './form';

// A price as the API sends it (text with three decimals), followed by the currency. The number is
// written left to right on an Arabic screen too, so its digits and its sign never change places.
// A change of price (a modifier, an extra charge) can show its sign: +6.000, -5.000, 0.000.
export function Price({ value, signed = false }: { value: string; signed?: boolean }) {
  const { t } = useTranslation();
  const text = signed && Number(value) > 0 ? `+${value}` : value;

  return (
    <span className="whitespace-nowrap">
      <bdi dir="ltr">{text}</bdi> {t('menu.currency')}
    </span>
  );
}

type PriceInputProps = Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onChange: (value: string) => void;
};

// A box for a price or a change of price. It is always written left to right, and digits typed
// on an Arabic keyboard are changed to plain digits. The rules check the value when it is saved.
export function PriceInput({ value, onChange, className = fieldClass, ...rest }: PriceInputProps) {
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      dir="ltr"
      autoComplete="off"
      value={value}
      onChange={(event) => onChange(normalizeNumberInput(event.target.value))}
      className={className}
    />
  );
}
