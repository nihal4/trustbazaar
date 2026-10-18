import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError, readCookie } from '../src/api.js';

const json = (status, body, headers = {}) => new Response(body === undefined ? null : JSON.stringify(body),
  { status, headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json', ...headers } });

/** a fake server: the access token is valid when `fresh` is true; refresh makes it fresh */
function server({ refreshStatus = [204], expired = true } = {}) {
  const s = { calls: [], refreshes: 0, fresh: !expired };
  s.fetch = async (url, init) => {
    s.calls.push({ url, ...init, headers: { ...(init.headers ?? {}) } });
    if (url.endsWith('/auth/refresh')) {
      const st = refreshStatus[Math.min(s.refreshes, refreshStatus.length - 1)];
      s.refreshes++;
      if (st === 204) s.fresh = true;
      return new Response(null, { status: st });
    }
    await new Promise((r) => setTimeout(r, 5));
    if (!s.fresh) return json(401, { type: 'https://trustbazaar.test/problems/unauthenticated', title: 'Sign in', correlationId: 'c-1' });
    return json(200, { ok: true, path: url });
  };
  return s;
}

const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const make = (s, o = {}) => createApi({ fetch: s.fetch, cookies: () => 'a=1; __Host-tb_csrf=tok%2Fxyz; b=2',
  store: memStore(), locks: undefined, sleep: async () => {}, ...o });

test('cookie reading', () => {
  assert.equal(readCookie('a=1; __Host-tb_csrf=tok%2Fxyz', '__Host-tb_csrf'), 'tok/xyz');
  assert.equal(readCookie('a=1', '__Host-tb_csrf'), null);
});

test('SEC-SES-04 state-changing requests carry the CSRF token; reads do not', async () => {
  const s = server({ expired: false });
  const api = make(s);
  await api.get('/orders');
  await api.post('/orders/1/confirm-receipt', { x: 1 });
  assert.equal(s.calls[0].headers['X-CSRF-Token'], undefined);
  assert.equal(s.calls[1].headers['X-CSRF-Token'], 'tok/xyz');
  assert.equal(s.calls[1].credentials, 'same-origin');
  assert.equal(s.calls[1].body, '{"x":1}');
  assert.equal(s.calls[1].url, '/api/v1/orders/1/confirm-receipt');
});

test('SEC-SES-02 an expired token is refreshed once; the retry keeps its Idempotency-Key', async () => {
  const s = server();
  const api = make(s);
  const r = await api.post('/orders/1/payments', { provider: 'bkash' }, { idempotent: true });
  assert.equal(r.ok, true);
  assert.equal(s.refreshes, 1);
  const tries = s.calls.filter((c) => c.url.endsWith('/payments'));
  assert.equal(tries.length, 2);
  assert.match(tries[0].headers['Idempotency-Key'], /^[0-9a-f-]{36}$/);
  assert.equal(tries[1].headers['Idempotency-Key'], tries[0].headers['Idempotency-Key']);
});

test('ten requests failing together cause one refresh in the tab', async () => {
  const s = server();
  const api = make(s);
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => api.get(`/x/${i}`)));
  assert.equal(rs.length, 10);
  assert.equal(s.refreshes, 1);
});

test('a refresh done by another tab after our request was sent is reused', async () => {
  const s = server();
  const store = memStore();
  let clock = 1000;
  s.fetch = ((orig) => async (url, init) => {
    const r = await orig(url, init);
    if (r.status === 401) { store.setItem('tb.refreshedAt/auth/refresh', String(clock + 500)); s.fresh = true; }   // the other tab
    return r;
  })(s.fetch);
  const api = make(s, { store, now: () => clock });
  await api.get('/me');
  assert.equal(s.refreshes, 0);
});

test('another tab refreshed but its localStorage mark is not visible yet: the probe sees the new cookies', async () => {
  const s = server();
  let n = 0;
  s.fetch = ((orig) => async (url, init) => {
    const r = await orig(url, init);
    if (r.status === 401 && ++n === 1) s.fresh = true;        // the other tab refreshed just after our request
    return r;
  })(s.fetch);
  await make(s).get('/orders');
  assert.equal(s.refreshes, 0);
  assert.deepEqual(s.calls.map((c) => c.url), ['/api/v1/orders', '/api/v1/me', '/api/v1/orders']);
});

test('409 from refresh (rotated by another tab a moment ago) is retried', async () => {
  const s = server({ refreshStatus: [409, 204] });
  await make(s).get('/me');
  assert.equal(s.refreshes, 2);
});

test('SEC-SES-05 a refused refresh signs the user out', async () => {
  const s = server({ refreshStatus: [401] });
  let out = 0;
  const err = await make(s, { onSignedOut: () => out++ }).get('/me').catch((e) => e);
  assert.ok(err instanceof ApiError);
  assert.equal(err.status, 401);
  assert.equal(err.messageKey, 'error.session_ended');
  assert.equal(out, 1);
});

test('still 401 after a successful refresh: signed out, no second refresh', async () => {
  const s = server();
  s.fetch = ((orig) => async (url, init) => { const r = await orig(url, init); s.fresh = false; return r; })(s.fetch);
  let out = 0;
  const err = await make(s, { onSignedOut: () => out++ }).get('/me').catch((e) => e);
  assert.equal(err.status, 401);
  assert.equal(s.refreshes, 1);
  assert.equal(out, 1);
});

test('SEC-INP-06 problem documents keep their correlation id; 429 keeps Retry-After', async () => {
  const f = async () => json(429, { type: 'https://trustbazaar.test/problems/rate-limited', title: 'Slow down', correlationId: 'c-9' }, { 'Retry-After': '17' });
  const err = await make({ fetch: f }).post('/bids', {}).catch((e) => e);
  assert.equal(err.status, 429);
  assert.equal(err.retryAfter, 17);
  assert.equal(err.correlationId, 'c-9');
  assert.equal(err.messageKey, 'error.rate_limited');
  const e500 = await make({ fetch: async () => json(500, { title: 'Internal', correlationId: 'c-5' }) }).get('/x').catch((e) => e);
  assert.equal(e500.messageKey, 'error.generic');
  assert.equal(e500.correlationId, 'c-5');
});

test('network failures and aborts', async () => {
  const net = await make({ fetch: async () => { throw new TypeError('Failed to fetch'); } }).get('/x').catch((e) => e);
  assert.equal(net.status, 0);
  assert.equal(net.messageKey, 'error.network');
  const ab = await make({ fetch: async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); } }).get('/x').catch((e) => e);
  assert.equal(ab.name, 'AbortError');
});

test('SEC-AUTH-08 a step-up action obtains a grant first and sends it in X-Step-Up', async () => {
  const s = server({ expired: false });
  const asked = [];
  const api = make(s, { stepUp: async (a) => { asked.push(a); return 'grant-1'; } });
  await api.post('/me/payout-account', { kind: 'bkash_wallet' }, { stepUpAction: 'payout.change' });
  assert.deepEqual(asked, ['payout.change']);
  assert.equal(s.calls[0].headers['X-Step-Up'], 'grant-1');
  const step = await make({ fetch: async () => json(403, { type: 'https://trustbazaar.test/problems/step-up-required' }) }).post('/x', {}).catch((e) => e);
  assert.equal(step.messageKey, 'error.step_up');
  await assert.rejects(make(s).post('/x', {}, { stepUpAction: 'password.change' }), /stepUp handler/);
});

test('the staff console uses its own CSRF cookie and refresh path', async () => {
  const s = server();
  const api = createApi({ fetch: s.fetch, cookies: () => '__Host-tb_csrf=user; __Host-tb_scsrf=staff', store: memStore(),
    sleep: async () => {}, csrfCookie: '__Host-tb_scsrf', refreshPath: '/staff/auth/refresh', probePath: '/staff/me' });
  await api.post('/staff/disputes/1/decision', {});
  assert.ok(s.calls.some((c) => c.url === '/api/v1/staff/auth/refresh' && c.headers['X-CSRF-Token'] === 'staff'));
  assert.ok(s.calls.filter((c) => c.url.endsWith('/decision')).every((c) => c.headers['X-CSRF-Token'] === 'staff'));
});

test('204 returns null', async () => {
  assert.equal(await make({ fetch: async () => new Response(null, { status: 204 }) }).post('/x', {}), null);
});
