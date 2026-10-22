import type { Language } from '@pos/shared';
import { useTranslation } from 'react-i18next';
import { setLanguage } from '.';

// Shows the other language in its own script, for example "العربية" while the page is in English.
// A dark screen (the kitchen) passes its own look.
export function LanguageSwitcher({ className }: { className?: string } = {}) {
  const { t, i18n } = useTranslation();
  const next: Language = i18n.language === 'ar' ? 'en' : 'ar';

  return (
    <button
      type="button"
      lang={next}
      aria-label={t('language.switchTo')}
      onClick={() => void setLanguage(next)}
      className={
        className ??
        'inline-flex min-h-11 items-center rounded-control border border-slate-300 bg-white px-3 text-sm font-semibold text-ink hover:border-slate-400 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-ink/25 focus-visible:outline-none'
      }
    >
      {next === 'ar' ? t('language.arabic') : t('language.english')}
    </button>
  );
}
