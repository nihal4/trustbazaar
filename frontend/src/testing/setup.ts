// Test support (not part of any bundle): jsdom has no matchMedia, which useMediaQuery reads for the phone layout. The stand-in matches nothing, as a desktop browser without those preferences would.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom has no canvas: say so quietly (null, as a browser without canvas answers) instead of logging "Not implemented" for every page that draws one.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
}
