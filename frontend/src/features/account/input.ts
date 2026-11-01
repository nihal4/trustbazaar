// Early checks for the account forms. The server decides (Unit 1); these only answer at once what
// the server would refuse anyway, so the user is not kept waiting.
import { toAsciiDigits } from '../../lib/money.js';

/**
 * A Bangladeshi mobile number as Unit 1 accepts it (+8801[3-9]XXXXXXXX), from what people type:
 * Bangla or ASCII digits, with or without +88 or 88, spaces and hyphens. Null if it is not one.
 */
export function bangladeshiMobile(input: string): string | null {
  const s = toAsciiDigits(input).replace(/[\s-]/g, '');
  const m = /^(?:\+?88)?(01[3-9]\d{8})$/.exec(s);
  return m ? `+88${m[1]}` : null;
}

/** A login is a mobile number unless it has an @. */
export function loginKind(login: string): 'phone' | 'email' {
  return login.includes('@') ? 'email' : 'phone';
}

/** What the sign-in and reset forms send: digits made ASCII, numbers in Unit 1's form. */
export function normaliseLogin(login: string): string {
  const s = login.trim();
  return loginKind(s) === 'phone' ? bangladeshiMobile(s) ?? toAsciiDigits(s) : s;
}

export const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) && s.trim().length <= 254;

/** SEC-AUTH-01 as Unit 1 applies it: 15 characters without MFA, 8 with it; at most 256 (DV-8). */
export const PASSWORD = { minSingleFactor: 15, minWithMfa: 8, max: 256 } as const;

export function passwordLengthProblem(password: string, mfa = false): 'too-short' | 'too-long' | null {
  const n = [...password.normalize('NFC')].length;
  if (n > PASSWORD.max) return 'too-long';
  if (n < (mfa ? PASSWORD.minWithMfa : PASSWORD.minSingleFactor)) return 'too-short';
  return null;
}

export const isSixDigits = (code: string) => /^\d{6}$/.test(toAsciiDigits(code).trim());

/**
 * Where to go after signing in: a path on this site only (no other host, no protocol-relative or
 * backslash tricks); anything else gives the fallback.
 */
export function safeNext(next: string | null, fallback = '/account'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  try {
    const u = new URL(next, 'https://tb.invalid');
    if (u.origin !== 'https://tb.invalid') return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}

/** Paths served by another document: reached with a normal page load (section 3.1). */
export const inOtherDocument = (path: string) => /^\/(staff|admin|secure|account\/kyc)(\/|$|\?)/.test(path);
