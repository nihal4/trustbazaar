// TrustBazaar web client - HTTP API client (Unit 8 reference module).
// Unit 1 decides the rules this client follows:
//  * tokens live only in HttpOnly cookies; this code never sees them (SEC-SES-03);
//  * every state-changing request carries X-CSRF-Token, copied from the readable __Host-tb_csrf
//    cookie (signed double submit, SEC-SES-04);
//  * an expired access token gives 401; the client refreshes once and retries once. Refreshes are
//    serialised across tabs with the Web Locks API, and a tab that waited for another tab's
//    refresh does not refresh again: inside the lock it first checks whether its cookies already
//    work (Unit 1, "Parallel tabs");
//  * errors are RFC 9457 problem documents with a correlationId (DC-3, SEC-INP-06).

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const REFRESH_MARK = 'tb.refreshedAt';     // a time, not a secret: when some tab last refreshed

export class ApiError extends Error {
  /**
   * @param {number} status 0 for network failures
   * @param {{type?: string, title?: string, correlationId?: string, errors?: unknown, retryAfter?: number}} p
   */
  constructor(status, p = {}) {
    super(p.title ?? `HTTP ${status}`);
    this.status = status;
    this.type = p.type ?? (status === 0 ? 'network' : 'about:blank');
    this.correlationId = p.correlationId;
    this.errors = p.errors;
    this.retryAfter = p.retryAfter;
  }
  /** the catalogue key the screen shows for this error */
  get messageKey() {
    if (this.status === 0) return 'error.network';
    if (this.status === 401) return 'error.session_ended';
    if (this.status === 403 && this.type.endsWith('/step-up-required')) return 'error.step_up';
    if (this.status === 403) return 'error.forbidden';
    if (this.status === 404) return 'error.not_found';
    if (this.status === 409) return 'error.conflict';
    if (this.status === 429) return 'error.rate_limited';
    return 'error.generic';
  }
}

/** @param {string} cookieHeader @param {string} name */
export function readCookie(cookieHeader, name) {
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/**
 * @param {object} o
 * @param {string} [o.base]
 * @param {typeof fetch} [o.fetch]
 * @param {() => string} [o.cookies]                 document.cookie
 * @param {{request: (name: string, cb: () => Promise<unknown>) => Promise<unknown>}} [o.locks]  navigator.locks
 * @param {{getItem(k: string): string|null, setItem(k: string, v: string): void}} [o.store]  localStorage
 * @param {(action: string) => Promise<string>} [o.stepUp]  shows the OTP dialog; resolves to a grant
 * @param {() => void} [o.onSignedOut]
 * @param {string} [o.probePath]                  a cheap authenticated GET (Unit 1: GET /me)
 * @param {string} [o.csrfCookie]                 '__Host-tb_csrf'; the staff console uses its own (I-51)
 * @param {string} [o.refreshPath]                '/auth/refresh'; staff: '/staff/auth/refresh'
 * @param {() => number} [o.now]
 * @param {(ms: number) => Promise<void>} [o.sleep]
 */
export function createApi({
  base = '/api/v1', fetch: f = globalThis.fetch.bind(globalThis), cookies = () => document.cookie,
  locks = globalThis.navigator?.locks, store = globalThis.localStorage, stepUp, onSignedOut = () => {},
  probePath = '/me', csrfCookie = '__Host-tb_csrf', refreshPath = '/auth/refresh', now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  /** @type {Promise<boolean> | null} one refresh at a time inside this tab */
  let inFlight = null;

  /** @param {number} failedAt when the request that got 401 was sent */
  async function refresh(failedAt) {
    if (!inFlight) {
      const run = async () => {
        // Another tab may have refreshed while we waited for the lock; its cookies are ours too.
        // The mark in localStorage is a fast hint only: tabs see each other's localStorage writes
        // with a delay, so a missing mark proves nothing. The probe asks the cookie jar itself.
        const mark = Number(store?.getItem(REFRESH_MARK + refreshPath) ?? 0);
        if (mark >= failedAt) return true;
        const probe = await f(base + probePath, { method: 'GET', credentials: 'same-origin',
          headers: { Accept: 'application/json' } }).catch(() => null);
        if (probe?.ok) return true;
        for (let attempt = 0; attempt < 2; attempt++) {
          const r = await f(base + refreshPath, { method: 'POST', credentials: 'same-origin',
            headers: { 'X-CSRF-Token': readCookie(cookies(), csrfCookie) ?? '' } });
          if (r.status === 204 || r.ok) { store?.setItem(REFRESH_MARK + refreshPath, String(now())); return true; }
          if (r.status === 409) { await sleep(300); continue; }   // rotated a moment ago by another tab
          return false;
        }
        return false;
      };
      inFlight = (locks ? locks.request('tb-refresh', run) : run())
        .then((ok) => /** @type {boolean} */ (ok)).finally(() => { inFlight = null; });
    }
    return inFlight;
  }

  /**
   * @param {string} method
   * @param {string} path            under /api/v1
   * @param {object} [o]
   * @param {unknown} [o.body]
   * @param {string} [o.stepUpAction]  Unit 1 step-up action; a grant is obtained first (SEC-AUTH-08)
   * @param {boolean} [o.idempotent]   send an Idempotency-Key that stays the same across retries
   * @param {AbortSignal} [o.signal]
   * @returns {Promise<any>}
   */
  async function request(method, path, { body, stepUpAction, idempotent = false, signal } = {}) {
    /** @type {Record<string, string>} */
    const headers = { Accept: 'application/json, application/problem+json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotent) headers['Idempotency-Key'] = globalThis.crypto.randomUUID();
    if (stepUpAction) {
      if (!stepUp) throw new Error('stepUp handler not configured');
      headers['X-Step-Up'] = await stepUp(stepUpAction);
    }
    let refreshed = false;
    for (;;) {
      if (STATE_CHANGING.has(method)) headers['X-CSRF-Token'] = readCookie(cookies(), csrfCookie) ?? '';
      const sentAt = now();
      let res;
      try {
        res = await f(base + path, { method, headers, credentials: 'same-origin', signal,
          body: body === undefined ? undefined : JSON.stringify(body) });
      } catch (e) {
        if (/** @type {any} */ (e)?.name === 'AbortError') throw e;
        throw new ApiError(0, { title: 'network' });
      }
      if (res.status === 401) {
        if (!refreshed) {
          refreshed = true;
          if (await refresh(sentAt)) continue;    // same headers, so the same Idempotency-Key
        }
        onSignedOut();                            // refresh refused, or still 401 after it
      }
      if (res.status === 204) return null;
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (res.ok) return data;
      const retry = res.headers.get('Retry-After');
      throw new ApiError(res.status, { ...(data ?? {}), retryAfter: retry ? Number(retry) : undefined });
    }
  }

  return {
    request,
    get: (/** @type {string} */ p, o = {}) => request('GET', p, o),
    post: (/** @type {string} */ p, /** @type {unknown} */ body, o = {}) => request('POST', p, { ...o, body }),
    put: (/** @type {string} */ p, /** @type {unknown} */ body, o = {}) => request('PUT', p, { ...o, body }),
    patch: (/** @type {string} */ p, /** @type {unknown} */ body, o = {}) => request('PATCH', p, { ...o, body }),
    del: (/** @type {string} */ p, o = {}) => request('DELETE', p, o),
  };
}
