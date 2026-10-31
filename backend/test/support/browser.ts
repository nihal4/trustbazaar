import { randomInt } from 'crypto';
import type { TestApp } from './app';

// A browser for API tests: keeps the cookies the backend sets, sends Origin and, on state-changing
// requests, X-CSRF-Token copied from the CSRF cookie, as the web client does (docs/design/web/src/api.js).
// Each browser has its own client address (X-Forwarded-For through the one trusted proxy hop), so the
// per-address rate limits of one test do not affect another.
export class Browser {
  readonly cookies = new Map<string, string>();
  readonly setCookieLines: string[] = [];
  readonly ip = `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}`;

  constructor(
    private readonly app: TestApp,
    private readonly origin: string,
    private readonly csrfCookie = '__Host-tb_csrf',
  ) {}

  async request(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Response> {
    const headers: Record<string, string> = { origin: this.origin, 'x-forwarded-for': this.ip, 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0', ...extra };
    if (this.cookies.size > 0) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const csrf = this.cookies.get(this.csrfCookie);
    if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(this.app.url(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const line of res.headers.getSetCookie()) {
      this.setCookieLines.push(line);
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = decodeURIComponent(pair.slice(eq + 1).trim());
      const expired = attrs.some((a) => /^\s*expires=Thu, 01 Jan 1970/i.test(a) || /^\s*max-age=0\s*$/i.test(a));
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  get = (path: string) => this.request('GET', path);
  post = (path: string, body?: unknown, headers?: Record<string, string>) => this.request('POST', path, body ?? {}, headers);
  del = (path: string) => this.request('DELETE', path);

  /** The attributes of the last Set-Cookie for a name, lower-cased, e.g. {httponly: true, path: '/'}. */
  attributes(name: string): Record<string, string | true> {
    const line = [...this.setCookieLines].reverse().find((l) => l.startsWith(`${name}=`));
    if (!line) return {};
    return Object.fromEntries(
      line.split(';').slice(1).map((a) => {
        const [k, v] = a.trim().split('=');
        return [k.toLowerCase(), v === undefined ? true : v];
      }),
    );
  }
}
