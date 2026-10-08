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
