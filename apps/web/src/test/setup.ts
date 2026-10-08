import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import i18n, { LANGUAGE_STORAGE_KEY } from '../i18n';
import { sessionStore } from '../lib/session-store';

// Every test starts signed out, in English, with nothing saved in the browser.
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStore.set(null);
  await i18n.changeLanguage('en');
  localStorage.removeItem(LANGUAGE_STORAGE_KEY);
});
