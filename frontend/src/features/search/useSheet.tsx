// The open and closed state of the filter sheet on a phone, with the focus handling.
import { useEffect, useState } from 'react';

/** true while the viewport is narrower than 60rem, where the open filters are a sheet over the page */
export function useSheet(): boolean {
  const query = '(max-width: 59.99rem)';
  const [sheet, setSheet] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const m = window.matchMedia(query);
    const on = () => setSheet(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return sheet;
}
