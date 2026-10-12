import { localizedTextSchema } from '@pos/shared';
import { z } from 'zod';

// The branch this terminal belongs to, kept in the browser so the PIN screen can name and send
// it before anybody is signed in. Nothing in it is secret. See docs/specs/006-pos-terminal.md,
// rule 1.
export const terminalSchema = z.object({
  branchId: z.uuid(),
  brandId: z.uuid(),
  branchName: localizedTextSchema,
  // A branch manager cannot read the names of brands, so a terminal they set up has none.
  brandName: localizedTextSchema.nullable(),
});

export type Terminal = z.infer<typeof terminalSchema>;

const KEY = 'pos.terminal';

// Storage can be missing or refused (a private window, blocked site data): the terminal is then
// simply not set up, and setting it up lasts until the page is closed.
let fallback: Terminal | null = null;

export function readTerminal(): Terminal | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return fallback;
    const parsed = terminalSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return fallback;
  }
}

export function saveTerminal(terminal: Terminal): void {
  fallback = terminal;
  try {
    localStorage.setItem(KEY, JSON.stringify(terminal));
  } catch {
    // Kept in memory only.
  }
}

export function forgetTerminal(): void {
  fallback = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing was stored.
  }
}
