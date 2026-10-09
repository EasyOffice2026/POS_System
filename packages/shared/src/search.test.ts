import { describe, expect, it } from 'vitest';
import { normalizeSearchText, searchQuerySchema, searchTextOf } from './search';

describe('normalizeSearchText', () => {
  it('ignores capital letters', () => {
    expect(normalizeSearchText('Margherita PIZZA')).toBe('margherita pizza');
  });

  it('ignores the marks above and below Arabic letters', () => {
    expect(normalizeSearchText('بِيتزا')).toBe('بيتزا');
    expect(normalizeSearchText('مُحَمَّد')).toBe('محمد');
    expect(normalizeSearchText('قَهْوَة')).toBe('قهوة');
  });

  it('ignores the stretching line', () => {
    expect(normalizeSearchText('بـيـتـزا')).toBe('بيتزا');
  });

  it('treats the forms of alef as one', () => {
    for (const alef of ['أ', 'إ', 'آ', 'ٱ', 'ا']) {
      expect(normalizeSearchText(`${alef}رز`)).toBe('ارز');
    }
  });

  it('writes Arabic-Indic and Persian digits as the digits we use', () => {
    expect(normalizeSearchText('٣ جبنة')).toBe('3 جبنة');
    expect(normalizeSearchText('combo ۱۲')).toBe('combo 12');
  });

  it('reads Arabic presentation forms as the letters they stand for', () => {
    expect(normalizeSearchText('ﻡﻣ')).toBe('مم');
  });

  it('collapses spaces and trims', () => {
    expect(normalizeSearchText('  بيتزا    مارجريتا ')).toBe('بيتزا مارجريتا');
  });

  it('keeps letters that really are different', () => {
    expect(normalizeSearchText('على')).toBe('على');
    expect(normalizeSearchText('علي')).toBe('علي');
  });

  it('finds an Arabic word whatever its marks and alef', () => {
    const stored = normalizeSearchText('بِيتزا أرز إيدام');

    expect(stored).toContain(normalizeSearchText('بيتزا'));
    expect(stored).toContain(normalizeSearchText('ارز'));
    expect(stored).toContain(normalizeSearchText('ايدام'));
    expect(stored).not.toContain(normalizeSearchText('برجر'));
  });

  it('does not change a text that is already plain', () => {
    expect(normalizeSearchText(normalizeSearchText('Pizza أرز ٣'))).toBe('pizza ارز 3');
  });
});

describe('searchTextOf', () => {
  it('puts the English name first, then the Arabic one, both normalized', () => {
    expect(searchTextOf({ en: 'Margherita Pizza', ar: 'بِيتزا مارجريتا' })).toBe(
      'margherita pizza بيتزا مارجريتا',
    );
  });
});

describe('searchQuerySchema', () => {
  it('trims what was typed, and refuses nothing and too much', () => {
    expect(searchQuerySchema.parse('  pizza ')).toBe('pizza');
    expect(searchQuerySchema.safeParse('   ').success).toBe(false);
    expect(searchQuerySchema.safeParse('x'.repeat(101)).success).toBe(false);
  });
});
