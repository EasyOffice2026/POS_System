import type { LocalizedText } from '@pos/shared';

// Picks the text in the current interface language. Both languages are always present.
export function localize(text: LocalizedText, language: string): string {
  return language === 'ar' ? text.ar : text.en;
}
