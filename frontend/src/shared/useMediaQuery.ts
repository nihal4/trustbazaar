// Whether a CSS media query matches now, and again whenever it starts or stops matching (the header and the tab bar differ on a phone). The first render already has the right answer
// (it is read from the browser, not after an effect), so a phone does not flash the desktop layout. Where there is no matchMedia (a test, an old browser) it is the fallback.
import { useSyncExternalStore } from 'react';

export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = typeof window !== 'undefined' ? window.matchMedia?.(query) : undefined;
      list?.addEventListener?.('change', notify);
      return () => list?.removeEventListener?.('change', notify);
    },
    () => (typeof window !== 'undefined' ? (window.matchMedia?.(query).matches ?? fallback) : fallback),
    () => fallback,
  );
}
