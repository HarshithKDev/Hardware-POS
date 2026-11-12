import { useEffect, useState } from 'react';

/**
 * True while the CSS media query matches (e.g. '(max-width: 767px)' for phones).
 * Returns false where matchMedia is unavailable (tests, very old browsers), so the
 * desktop layout is the fallback.
 */
export function useMediaQuery(query) {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener ? mql.addEventListener('change', onChange) : mql.addListener(onChange);
    return () => { mql.removeEventListener ? mql.removeEventListener('change', onChange) : mql.removeListener(onChange); };
  }, [query]);
  return matches;
}

/** Phone-sized screen (below Tailwind's md breakpoint). */
export const usePhoneLayout = () => useMediaQuery('(max-width: 767px)');
