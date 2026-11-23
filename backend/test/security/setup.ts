import { randomInt, randomUUID } from 'crypto';
import { authenticator } from 'otplib';
import { loadConfig, type TbConfig } from '../../src/kernel/config/config';
import { NOTIFICATIONS, ForwardedNotifications } from '../../src/modules/identity/adapters/notifications';
import { startApp, TestApp } from '../support/app';
import { Browser } from '../support/browser';
import { IdentityFixtures } from '../support/identity';

// The security test suite (U9-02; docs/design/09_integration.pdf section 7.4): one file per security requirement
// marked T, named after it, against the whole backend over HTTP with PostgreSQL and Redis, as the API tests run.
// Each file calls suite() once at its top level; the helpers below are what most of them need.

export interface Suite {
  t: TestApp;
  fx: IdentityFixtures;
  cfg: TbConfig;
  origin: string;
  /** A browser with its own client address (support/browser.ts); it answers the human check by itself. */
  browser: () => Browser;
  /** Messages the backend sent (log mode), to one address, optionally of one template. */
  sent: (to: string, template?: string) => { channel: string; to: string; template: string; vars: Record<string, string> }[];
  /** A member signed in through the real sign-in, and their browser. */
  signedIn: (o?: Parameters<IdentityFixtures['account']>[0]) => Promise<{ a: Awaited<ReturnType<IdentityFixtures['account']>>; b: Browser }>;
  /** A staff member signed in with password and TOTP through the real staff sign-in, and their browser. */
  signedInStaff: (role: 'operator' | 'administrator') => Promise<{ s: Awaited<ReturnType<IdentityFixtures['staffAccount']>>; b: Browser }>;
}

export function suite(): Suite {
  const s = {} as Suite;
  beforeAll(async () => {
    s.t = await startApp();
    s.fx = await IdentityFixtures.open();
    s.cfg = loadConfig(process.env);
    s.origin = s.cfg.publicOrigin;
    const notes = s.t.app.get<ForwardedNotifications>(NOTIFICATIONS);
    s.sent = (to, template) =>
      notes.sent.filter((m) => m.to.toLowerCase() === to.toLowerCase() && (template === undefined || m.template === template)) as ReturnType<Suite['sent']>;
  });
  afterAll(async () => {
    await s.fx?.close();
    await s.t?.close();
  });
  s.browser = () => new Browser(s.t, s.origin);
  s.signedIn = async (o) => {
    const a = await s.fx.account({ password: `pw ${randomUUID()}`, ...o });
    const b = s.browser();
    const r = await b.post('/auth/signin', { login: a.phone, password: a.password });
    if (r.status === 200) expect((await b.post('/auth/signin/mfa', { code: authenticator.generate(a.totpSecret!) })).status).toBe(204);
    else expect(r.status).toBe(204);
    return { a, b };
  };
  s.signedInStaff = async (role) => {
    const st = await s.fx.staffAccount(role);
    const b = new Browser(s.t, s.origin, '__Host-tb_scsrf');
    expect((await b.post('/staff/auth/signin', { email: st.email, password: st.password })).status).toBe(200);
    expect((await b.post('/staff/auth/mfa', { code: authenticator.generate(st.totpSecret!) })).status).toBe(204);
    return { s: st, b };
  };
  return s;
}

/** The problem document of a response: status, type, title and field errors. */
export async function problem(r: Response): Promise<{ status: number; type?: string; title?: string; errors?: { field: string; reason: string }[] }> {
  const b = (await r.json().catch(() => ({}))) as { type?: string; title?: string; errors?: { field: string; reason: string }[] };
  return { status: r.status, type: b.type, title: b.title, errors: b.errors };
}

/** A local mobile number no account has. */
export const newLocal = () => `019${String(randomInt(0, 1e8)).padStart(8, '0')}`;
