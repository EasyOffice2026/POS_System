import type { Language } from '@pos/shared';
import { useTranslation } from 'react-i18next';
import { setLanguage } from '.';

// Shows the other language in its own script, for example "العربية" while the page is in English.
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const next: Language = i18n.language === 'ar' ? 'en' : 'ar';

  return (
    <button
      type="button"
      lang={next}
      aria-label={t('language.switchTo')}
      onClick={() => void setLanguage(next)}
      className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:ring-2 focus:ring-slate-400 focus:outline-none"
    >
      {next === 'ar' ? t('language.arabic') : t('language.english')}
    </button>
  );
}
