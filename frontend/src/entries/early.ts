// Starts a listing page's one request while the app's scripts are still loading (NFR-PERF-07; Decisions log, U8-11).
// This module has no imports, so the browser runs it as soon as it arrives, before the larger app chunks; the listing
// page takes the answer if it is a success and otherwise asks again through the API client (refresh, errors).
const m = /^\/listings\/([0-9a-f-]{36})\/?$/i.exec(location.pathname);
if (m) {
  const path = `/listings/${m[1].toLowerCase()}`;
  const answer = fetch(`/api/v1${path}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : undefined))
    .catch(() => undefined);
  (window as unknown as { __tbEarly?: Record<string, Promise<unknown>> }).__tbEarly = { [path]: answer };
}
