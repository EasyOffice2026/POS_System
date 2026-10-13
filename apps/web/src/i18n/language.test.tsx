import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { detectLanguage, directionOf, LANGUAGE_STORAGE_KEY } from '.';
import { LanguageSwitcher } from './LanguageSwitcher';
import { localize } from './localize';

describe('detectLanguage', () => {
  it('uses the saved choice first', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'ar');
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');

    expect(detectLanguage()).toBe('ar');
  });

  it('follows an Arabic browser when nothing is saved', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ar-SA');

    expect(detectLanguage()).toBe('ar');
  });

  it('uses English for any other browser language', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('fr-FR');

    expect(detectLanguage()).toBe('en');
  });

  it('ignores a saved value that is not a supported language', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'fr');
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ar');

    expect(detectLanguage()).toBe('ar');
  });

  it('still works when the browser blocks storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB');

    expect(detectLanguage()).toBe('en');
  });
});

describe('directionOf', () => {
  it('writes Arabic right to left and English left to right', () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
  });
});

describe('LanguageSwitcher', () => {
  it('flips the page to Arabic and right to left, and remembers the choice', async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);

    await user.click(screen.getByRole('button', { name: 'Switch language' }));

    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ar');
  });

  it('shows the other language in its own script, and flips back', async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);
    expect(screen.getByRole('button')).toHaveTextContent('العربية');

    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveTextContent('English');
    expect(screen.getByRole('button', { name: 'تغيير اللغة' })).toBeInTheDocument();

    await user.click(screen.getByRole('button'));
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
  });

  it('marks the button with the language it will switch to, for screen readers', () => {
    render(<LanguageSwitcher />);

    expect(screen.getByRole('button')).toHaveAttribute('lang', 'ar');
  });
});

describe('localize', () => {
  const name = { en: 'Pizza Palace', ar: 'بيتزا بالاس' };

  it('picks the text for the current language', () => {
    expect(localize(name, 'en')).toBe('Pizza Palace');
    expect(localize(name, 'ar')).toBe('بيتزا بالاس');
  });
});
