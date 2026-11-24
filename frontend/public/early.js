// Starts a listing page's one request while the app's scripts are still loading (NFR-PERF-07; Decisions log, U8-11
// and U10-10). A classic script outside the bundle: when it was a second module script in index.html, Vite merged it
// into the app's entry chunk, so it ran only after the larger chunks had arrived. The listing page takes the answer
// once (src/shared/early.ts) if it is a success, and otherwise asks again through the API client (refresh, errors).
// The web server announces the same address with the page (a Link preload header, nginx.conf), so this fetch takes
// the answer the browser is already loading; the address must stay exactly the same (lower-case id, no query).
// As soon as the answer is here, the first photo, the page's largest paint, is asked for too, with the same candidates
// and sizes as the gallery's first image (src/features/listings/ListingPage.tsx), so the browser fetches it once.
/* global window, document, location, fetch */
(function () {
  'use strict';
  var PHOTO_SIZES = '(min-width: 60rem) 40rem, 100vw';
  var m = /^\/listings\/([0-9a-f-]{36})\/?$/i.exec(location.pathname);
  if (!m || typeof fetch !== 'function') return;
  var path = '/listings/' + m[1].toLowerCase();
  var answer = fetch('/api/v1' + path, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : undefined; })
    .then(function (l) {
      var first = l && l.photos && l.photos[0];
      if (first && /^\/api\/v1\//.test(first.url) && /^\/api\/v1\//.test(first.thumbUrl)) {
        var link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'image';
        link.setAttribute('imagesrcset', first.thumbUrl + ' 400w, ' + first.url + ' 1600w');
        link.setAttribute('imagesizes', PHOTO_SIZES);
        link.setAttribute('fetchpriority', 'high');
        document.head.appendChild(link);
      }
      return l;
    })
    .catch(function () { return undefined; });
  window.__tbEarly = {};
  window.__tbEarly[path] = answer;
})();
