import { z } from 'zod';

// Translatable content (menu names, brand names) is stored and sent as { en, ar }.
export const localizedTextSchema = z.object({
  en: z.string().min(1),
  ar: z.string().min(1),
});

export type LocalizedText = z.infer<typeof localizedTextSchema>;

export const languages = ['en', 'ar'] as const;
export const languageSchema = z.enum(languages);
export type Language = z.infer<typeof languageSchema>;

const nameInLanguage = z
  .string({ error: 'NAME_REQUIRED' })
  .trim()
  .min(1, 'NAME_REQUIRED')
  .max(100, 'NAME_TOO_LONG');

// A name that a request gives in both languages. Both are needed, a blank one counts as missing,
// and a problem is reported on the language that has it (name.en or name.ar).
export const localizedNameSchema = z.strictObject({
  en: nameInLanguage,
  ar: nameInLanguage,
});
