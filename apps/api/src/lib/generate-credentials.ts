import { pinProblem } from '@pos/shared';
import { randomInt } from 'node:crypto';

// Letters and digits that are hard to mix up when read aloud or written down:
// no 0 and O, no 1, l and I.
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

// A random 6-digit PIN that follows the PIN rules.
export function generatePin(): string {
  for (;;) {
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    if (!pinProblem(pin)) return pin;
  }
}

export function generatePassword(length = 16): string {
  return Array.from({ length }, () =>
    PASSWORD_ALPHABET.charAt(randomInt(PASSWORD_ALPHABET.length)),
  ).join('');
}
