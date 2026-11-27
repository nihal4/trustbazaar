// The colour theme, set before the first paint (U10-28): the choice a person made (kept in this browser as tb-theme: "light" or "dark") or, when there is none, dark, the
// look of the app. A classic script outside the bundle, so the page never flashes the other theme; every document (the app, the ID check, the console, the credential
// pages) loads it. It reads nothing but that one key and sets one attribute on <html>.
/* global document, localStorage */
(function () {
  'use strict';
  var theme = 'dark';
  try {
    var saved = localStorage.getItem('tb-theme');
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch (e) { /* storage may be blocked: the default stays */ }
  document.documentElement.setAttribute('data-theme', theme);
})();
