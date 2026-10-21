import { useState } from 'react';

interface BrandMarkProps {
  // The brand's name in the language on screen, for the initial and the logo's description.
  name: string;
  logoUrl?: string | null;
  // 'md' for headers, 'lg' for a sign-in or setup screen.
  size?: 'sm' | 'md' | 'lg';
}

const sizes = {
  sm: 'size-8 rounded-lg text-sm',
  md: 'size-10 rounded-[0.625rem] text-lg',
  lg: 'size-14 rounded-xl text-2xl',
};

// The brand's sign on its tills, kitchen screens and back office: its logo, or its first letter
// on the brand colour when it has none (or the logo cannot be loaded).
export function BrandMark({ name, logoUrl, size = 'md' }: BrandMarkProps) {
  const [broken, setBroken] = useState(false);
  const initial = Array.from(name.trim())[0] ?? '·';

  if (logoUrl && !broken) {
    return (
      <img
        src={logoUrl}
        alt={name}
        onError={() => setBroken(true)}
        className={`${sizes[size]} shrink-0 border border-line bg-white object-contain`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`${sizes[size]} grid shrink-0 place-items-center bg-brand font-bold text-white`}
    >
      {initial}
    </span>
  );
}
