import { describe, expect, it } from 'vitest';
import { normalizeNumberInput } from './numbers';

describe('normalizeNumberInput', () => {
  it('changes Arabic-Indic digits and the Arabic decimal mark to plain digits and a point', () => {
    expect(normalizeNumberInput('١٢٫٥٠٠')).toBe('12.500');
    expect(normalizeNumberInput('٠')).toBe('0');
  });

  it('changes the digits of a Persian keyboard too', () => {
    expect(normalizeNumberInput('۱۲.۵')).toBe('12.5');
  });

  it('leaves plain digits and everything else as it is, so a wrong value is still reported', () => {
    expect(normalizeNumberInput('12.500')).toBe('12.500');
    expect(normalizeNumberInput('-5')).toBe('-5');
    expect(normalizeNumberInput('12,5 abc')).toBe('12,5 abc');
    expect(normalizeNumberInput('')).toBe('');
  });
});
