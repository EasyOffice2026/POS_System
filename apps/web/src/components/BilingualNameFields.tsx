import { useTranslation } from 'react-i18next';
import { FormField, fieldAttributes, fieldClass } from './form';

interface BilingualNameFieldsProps {
  idPrefix: string;
  value: { en: string; ar: string };
  onChange: (value: { en: string; ar: string }) => void;
  // The problems as sentences, ready to show.
  errors?: { en?: string | undefined; ar?: string | undefined };
  disabled?: boolean;
  // The classes of the wrapper. "contents" lets a parent grid lay the two boxes out.
  className?: string;
}

// A name in English and in Arabic, side by side. Each box is written in its own direction,
// whatever the language of the screen, so typing feels right in both.
export function BilingualNameFields({
  idPrefix,
  value,
  onChange,
  errors = {},
  disabled = false,
  className = 'grid gap-4 sm:grid-cols-2',
}: BilingualNameFieldsProps) {
  const { t } = useTranslation();

  return (
    <div className={className}>
      <FormField id={`${idPrefix}-name-en`} label={t('common.nameEnglish')} error={errors.en}>
        <input
          {...fieldAttributes(`${idPrefix}-name-en`, { error: Boolean(errors.en) })}
          type="text"
          lang="en"
          dir="ltr"
          value={value.en}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, en: event.target.value })}
          className={fieldClass}
        />
      </FormField>

      <FormField id={`${idPrefix}-name-ar`} label={t('common.nameArabic')} error={errors.ar}>
        <input
          {...fieldAttributes(`${idPrefix}-name-ar`, { error: Boolean(errors.ar) })}
          type="text"
          lang="ar"
          dir="rtl"
          value={value.ar}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, ar: event.target.value })}
          className={fieldClass}
        />
      </FormField>
    </div>
  );
}
