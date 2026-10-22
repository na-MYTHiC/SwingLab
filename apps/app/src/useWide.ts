import { useEffect, useState } from 'react';

/**
 * True from the desktop breakpoint up.
 *
 * Disclosures that earn their fold on a phone (a plan block, a drill list) are
 * simply open on a laptop, where there is room to read them. The query matches
 * the 960px breakpoint in styles.css, so the layout and the open state flip
 * together.
 */
const QUERY = '(min-width: 960px)';

export function useWide(): boolean {
  const [wide, setWide] = useState(() => matches());
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(QUERY);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

function matches(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(QUERY).matches;
}
