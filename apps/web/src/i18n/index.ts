import { type Language, languageSchema } from '@pos/shared';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './locales/ar.json';
import en from './locales/en.json';

export const LANGUAGE_STORAGE_KEY = 'pos.language';

export function directionOf(language: Language): 'ltr' | 'rtl' {
  return language === 'ar' ? 'rtl' : 'ltr';
}

// Browsers can block storage (private windows, blocked site data), so every access is guarded.
function readStoredLanguage(): Language | null {
  try {
    const parsed = languageSchema.safeParse(localStorage.getItem(LANGUAGE_STORAGE_KEY));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// The saved choice wins. Otherwise follow the browser: Arabic for Arabic browsers, else English.
export function detectLanguage(): Language {
  return readStoredLanguage() ?? (navigator.language.toLowerCase().startsWith('ar') ? 'ar' : 'en');
}

// The page direction and language follow the interface language, so the whole layout mirrors.
export function applyDocumentLanguage(language: Language): void {
  document.documentElement.lang = language;
  document.documentElement.dir = directionOf(language);
}

function persistLanguage(language: Language): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Not saving the choice is fine.
  }
}

export function setLanguage(language: Language): Promise<unknown> {
  return i18n.changeLanguage(language);
}

const initialLanguage = detectLanguage();

await i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: initialLanguage,
  fallbackLng: 'en',
  supportedLngs: ['en', 'ar'],
  interpolation: { escapeValue: false },
});

applyDocumentLanguage(initialLanguage);

i18n.on('languageChanged', (language: string) => {
  const parsed = languageSchema.safeParse(language);
  if (parsed.success) {
    applyDocumentLanguage(parsed.data);
    persistLanguage(parsed.data);
  }
});

export default i18n;
