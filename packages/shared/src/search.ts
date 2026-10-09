import { z } from 'zod';

// Search ignores what a person does not type the same way every time: capital letters, the marks
// above and below Arabic letters (diacritics, called tashkeel), the stretching line (tatweel), the
// different forms of alef, and Arabic-Indic digits. Typing in Arabic finds Arabic names and typing
// in English finds English names, because each name is compared as it is written.
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[ً-ٰٟۖ-ۭـ]/g, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// What is stored with an item to search it, English name first, so the same text also puts
// items in the order of their English names.
export function searchTextOf(name: { en: string; ar: string }): string {
  return `${normalizeSearchText(name.en)} ${normalizeSearchText(name.ar)}`.trim();
}

// The words a person typed in the search box.
export const searchQuerySchema = z.string().trim().min(1).max(100);
