// Unit 8 reference modules in Chromium: real cookies, real Web Locks, real Intl.
// A small server plays Unit 1's cookie rules (HttpOnly access token, refresh cookie limited to its
// path, readable CSRF cookie, refresh rotation with a 10-second "used a moment ago" answer).
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { formatDateTime } from '../src/time.js';
import { formatMoney as fm } from '../src/money.js';

const bundle = readFileSync(new URL('./browser_bundle.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const check = (cond, label) => { if (cond) { pass++; console.log('PASS  ' + label); } else { fail++; console.log('FAIL  ' + label); } };

// ---------------------------------------------------------------- the fake Unit 1
const S = { gen: 1, rt: 'rt-1', rtUsedAt: 0, refreshes: 0, csrfBad: 0, seenAuthHeader: 0 };
const cookie = (req, name) => (req.headers.cookie ?? '').split(';').map((s) => s.trim().split('='))
  .find(([k]) => k === name)?.[1];
const setSession = (res) => res.setHeader('Set-Cookie', [
  `__Host-tb_at=at-${S.gen}; HttpOnly; Secure; SameSite=Strict; Path=/`,
  `__Secure-tb_rt=${S.rt}; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth/refresh`,
  `__Host-tb_csrf=csrf-${S.gen}; Secure; SameSite=Strict; Path=/`,
]);
const server = http.createServer((req, res) => {
  const u = req.url;
  if (req.headers.authorization) S.seenAuthHeader++;
  const send = (st, body) => { res.statusCode = st; res.setHeader('Content-Type', st >= 400 ? 'application/problem+json' : 'application/json'); res.end(body ? JSON.stringify(body) : undefined); };
  if (u === '/') { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><meta charset="utf-8"><script src="/b.js"></script>'); }
  if (u === '/b.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(bundle); }
  if (u === '/api/v1/test/sign-in') { setSession(res); return send(200, { ok: true }); }
  if (u === '/api/v1/test/expire') { S.gen++; return send(200, { gen: S.gen }); }         // every access token is now stale
  if (u === '/api/v1/auth/refresh') {
    if (req.method !== 'POST') return send(405, {});
    if (cookie(req, '__Host-tb_csrf') !== req.headers['x-csrf-token']) S.csrfBad++;
    const rt = cookie(req, '__Secure-tb_rt');
    if (rt !== S.rt) {
      if (Date.now() - S.rtUsedAt < 10_000) return send(409, { title: 'retry' });          // rotated a moment ago
      return send(401, { title: 'sign in' });
    }
    S.refreshes++; S.rtUsedAt = Date.now(); S.rt = `rt-${S.refreshes + 1}`;
    setSession(res); res.statusCode = 204; return res.end();
  }
  if (u.startsWith('/api/v1/')) {
    if (cookie(req, '__Host-tb_at') !== `at-${S.gen}`) return send(401, { title: 'expired', correlationId: 'c-401' });
    if (req.method === 'POST' && cookie(req, '__Host-tb_csrf') !== req.headers['x-csrf-token']) return send(403, { title: 'csrf' });
    setTimeout(() => send(200, { ok: true, gen: S.gen }), 20);
    return;
  }
  send(404, {});
});
await new Promise((r) => server.listen(0, 'localhost', r));
const origin = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ timezoneId: 'America/New_York', locale: 'en-US' });   // not Dhaka, on purpose
const tabs = [await ctx.newPage(), await ctx.newPage(), await ctx.newPage()];
for (const p of tabs) await p.goto(origin + '/');
const p0 = tabs[0];

// ---------------------------------------------------------------- cookies and CSRF
await p0.evaluate(() => fetch('/api/v1/test/sign-in', { method: 'POST' }));
const visible = await p0.evaluate(() => document.cookie);
check(!visible.includes('tb_at') && !visible.includes('tb_rt'), 'SEC-SES-03 the page cannot read the session cookies');
check(visible.includes('__Host-tb_csrf=csrf-1'), 'SEC-SES-04 the CSRF cookie is readable, so it can be copied into the header');
const posted = await p0.evaluate(async () => (await TB.createApi().post('/orders/1/confirm-receipt', {})).ok);
check(posted === true, 'a POST through the client passes the CSRF check');

// ---------------------------------------------------------------- refresh across tabs
await p0.evaluate(() => fetch('/api/v1/test/expire', { method: 'POST' }));
S.refreshes = 0;
const results = await Promise.all(tabs.map((p) => p.evaluate(async () => {
  const api = TB.createApi();
  const r = await Promise.all(Array.from({ length: 5 }, () => api.get('/me').then((x) => x.ok, (e) => e.status)));
  return r;
})));
const flat = results.flat();
check(flat.length === 15 && flat.every((x) => x === true), '15 requests from 3 tabs with an expired token all succeed');
check(S.refreshes === 1, `Unit 1 "parallel tabs": exactly one refresh for 3 tabs (got ${S.refreshes})`);
check(S.csrfBad === 0, 'the refresh request carries the CSRF token');
const stored = await p0.evaluate(() => Object.keys(localStorage));
check(stored.length === 1 && stored[0] === 'tb.refreshedAt/auth/refresh', 'localStorage holds only the refresh time, no token');
check(S.seenAuthHeader === 0, 'no request carries an Authorization header');

// five more expiries, each with the three tabs racing: one refresh every time
const counts = [];
for (let round = 0; round < 5; round++) {
  await p0.evaluate(() => fetch('/api/v1/test/expire', { method: 'POST' }));
  S.refreshes = 0;
  await Promise.all(tabs.map((p) => p.evaluate(() => TB.createApi().get('/orders'))));
  counts.push(S.refreshes);
}
check(counts.every((n) => n === 1), `five later expiries give one refresh each (got ${counts.join(', ')})`);

// a stolen-and-used refresh token: the server refuses, the tab is signed out
S.rt = 'someone-else'; S.rtUsedAt = 0;
await p0.evaluate(() => fetch('/api/v1/test/expire', { method: 'POST' }));
const out = await p0.evaluate(async () => {
  let signedOut = 0;
  const e = await TB.createApi({ onSignedOut: () => signedOut++ }).get('/me').catch((x) => x);
  return { status: e.status, key: e.messageKey, signedOut };
});
check(out.status === 401 && out.key === 'error.session_ended' && out.signedOut === 1, 'a refused refresh signs the tab out');

// ---------------------------------------------------------------- Intl in Chromium equals Node
const instants = [Date.UTC(2026, 9, 20, 12, 0), Date.UTC(2026, 9, 20, 18, 30), Date.UTC(2026, 9, 19, 23, 5), Date.UTC(2027, 0, 1, 0, 0)];
const inBrowser = await p0.evaluate((xs) => xs.flatMap((t) => [TB.formatDateTime(t, 'en'), TB.formatDateTime(t, 'bn')]), instants);
const inNode = instants.flatMap((t) => [formatDateTime(t, 'en'), formatDateTime(t, 'bn')]);
check(JSON.stringify(inBrowser) === JSON.stringify(inNode), `Dhaka date and time text in Chromium matches Node (${inNode.length} strings, en and bn)`);
const tz = await p0.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
const money = await p0.evaluate(() => [TB.formatMoney(123456750, 'bn'), TB.parseTaka('১২,৫০০.৫০').poisha.toString()]);
check(money[0] === fm(123456750, 'bn') && money[1] === '1250050', 'money text and parsing in Chromium match Node');

await browser.close();
server.close();
console.log(`\n${pass} checks passed, ${fail} failed (Chromium ${browser.version()}, browser time zone ${tz})`);
process.exit(fail ? 1 : 0);
