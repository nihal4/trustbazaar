// The cell of the sign-in grid (U10-25), shared by the page's frame (the logo) and its form (features/account/AuthSplit): one size for the whole page, so the
// logo's frame, the card and the animation all lie on the same lines. 32 px, or smaller on a screen only just wide enough to hold the 42 cells the wide
// layout needs (the animation on the left, the card on the right).
import { useEffect, useState } from 'react';

export const WIDE = 1100;
export const CARD_COLS = 15;
const WIDE_COLS = 42;

export function gridCell(vw: number): number {
  return vw >= WIDE ? Math.min(32, Math.floor(vw / WIDE_COLS)) : 32;
}

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
