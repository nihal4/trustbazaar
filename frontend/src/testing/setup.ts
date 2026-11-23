// Test support (not part of any bundle): jsdom has no matchMedia, which Mantine reads for the reduced-motion and
// colour-scheme settings. The stand-in matches nothing, as a desktop browser without those preferences would.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }) as MediaQueryList;
}
