// The cell of the sign-in grid (U10-25), shared by the page's form (features/account/AuthSplit) and the grid behind it: one size for the whole page, so the
// card's frame lies on the grid's lines.
import { useEffect, useState } from 'react';

export const CELL = 32;
export const CARD_COLS = 15;

export function useViewport(): { vw: number; vh: number } {
  const read = () => ({ vw: typeof window === 'undefined' ? 1280 : window.innerWidth, vh: typeof window === 'undefined' ? 800 : window.innerHeight });
  const [v, setV] = useState(read);
  useEffect(() => {
    const on = () => setV(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return v;
}
