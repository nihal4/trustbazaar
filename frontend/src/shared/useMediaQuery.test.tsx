// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useMediaQuery } from './useMediaQuery';

afterEach(cleanup);

/** A matchMedia whose answer the test changes and announces, as a browser does when the window is resized. */
function screenOf(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  })) as unknown as typeof window.matchMedia;
  return (next: boolean) => {
    matches = next;
    listeners.forEach((l) => l());
  };
}

describe('useMediaQuery', () => {
  it('NFR-USE-05 the first render already has the answer of the screen, and it follows a resize', () => {
    const resize = screenOf(true);
    const { result } = renderHook(() => useMediaQuery('(max-width: 47.99em)'));
    expect(result.current).toBe(true);
    act(() => resize(false));
    expect(result.current).toBe(false);
    act(() => resize(true));
    expect(result.current).toBe(true);
  });
});
