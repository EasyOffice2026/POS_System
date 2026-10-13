import { describe, expect, it } from 'vitest';
import ar from './locales/ar.json';
import en from './locales/en.json';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') result[path] = value;
    else Object.assign(result, flatten(value, path));
  }
  return result;
}

// Counted texts have one key per plural form: retryIn_one, retryIn_other, and so on.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const baseOf = (key: string) => key.replace(PLURAL_SUFFIX, '');
const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? '');

const english = flatten(en);
const arabic = flatten(ar);

describe('translations', () => {
  it('have the same texts in English and Arabic', () => {
    const bases = (texts: Record<string, string>) =>
      [...new Set(Object.keys(texts).map(baseOf))].sort();

    expect(bases(arabic)).toEqual(bases(english));
  });

  it('have no empty text', () => {
    for (const texts of [english, arabic]) {
      for (const [key, text] of Object.entries(texts)) {
        expect(text.trim(), key).not.toBe('');
      }
    }
  });

  it('use the same placeholders in both languages', () => {
    const forBase = (texts: Record<string, string>, base: string) =>
      [
        ...new Set(
          Object.entries(texts)
            .filter(([key]) => baseOf(key) === base)
            .flatMap(([, text]) => placeholders(text)),
        ),
      ].sort();

    for (const base of new Set(Object.keys(english).map(baseOf))) {
      expect(forBase(arabic, base), base).toEqual(forBase(english, base));
    }
  });

  it('give counted texts every plural form each language needs', () => {
    const counted = [
      ...new Set(
        Object.keys(english)
          .filter((key) => PLURAL_SUFFIX.test(key))
          .map(baseOf),
      ),
    ];
    expect(counted.length).toBeGreaterThan(0);

    for (const base of counted) {
      for (const form of ['one', 'other'])
        expect(english, `${base}_${form}`).toHaveProperty(`${base}_${form}`);
      for (const form of ['zero', 'one', 'two', 'few', 'many', 'other']) {
        expect(arabic, `${base}_${form}`).toHaveProperty(`${base}_${form}`);
      }
    }
  });
});
