import { passwordProblem, pinProblem } from '@pos/shared';
import { describe, expect, it } from 'vitest';
import { generatePassword, generatePin } from './generate-credentials';

describe('generatePin', () => {
  it('makes a 6-digit PIN that follows the rules, every time', () => {
    for (let count = 0; count < 500; count += 1) {
      const pin = generatePin();

      expect(pin).toMatch(/^\d{6}$/);
      expect(pinProblem(pin)).toBeNull();
    }
  });

  it('does not repeat itself', () => {
    const pins = new Set(Array.from({ length: 200 }, () => generatePin()));

    expect(pins.size).toBeGreaterThan(190);
  });
});

describe('generatePassword', () => {
  it('makes a password that follows the rules', () => {
    expect(passwordProblem(generatePassword())).toBeNull();
    expect(generatePassword()).toHaveLength(16);
  });

  it('uses only characters that are hard to mix up', () => {
    for (let count = 0; count < 200; count += 1) {
      expect(generatePassword(32)).toMatch(/^[A-HJ-NP-Za-km-z2-9]{32}$/);
    }
  });

  it('does not repeat itself', () => {
    const passwords = new Set(Array.from({ length: 200 }, () => generatePassword()));

    expect(passwords.size).toBe(200);
  });
});
