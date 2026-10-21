import { useEffect } from 'react';

// Puts the brand's colour on the page while a screen of that brand is open, for the utilities
// bg-brand, text-brand and bg-brand-soft (index.css). Without one the product's neutral stays.
export function useBrandColor(color: string | null | undefined) {
  useEffect(() => {
    if (!color) return;
    const root = document.documentElement;
    root.style.setProperty('--brand-color', color);
    return () => {
      root.style.removeProperty('--brand-color');
    };
  }, [color]);
}
