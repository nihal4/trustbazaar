import type { CookieOptions, Response } from 'express';
import { STAFF_COOKIES, USER_COOKIES } from '../security/cookies';

// The user's cookies (Unit 1 section 7.1). All are Secure and SameSite=Strict; only the CSRF cookie is
// readable by the page, which copies it into X-CSRF-Token. The refresh cookie is sent only to the refresh
// path. No token is ever put in a URL, a response body or browser storage (SEC-SES-03).
export const REFRESH_COOKIE = '__Secure-tb_rt';
export const REFRESH_PATH = '/api/v1/auth/refresh';
export const MFA_COOKIE = '__Host-tb_mfa';
export const DEVICE_COOKIE = '__Host-tb_dev';
const YEAR_MS = 365 * 24 * 3600 * 1000;

// `secure: true` is also written out in every call below so that static analysis (CodeQL) can see it.
const base: CookieOptions = { secure: true, sameSite: 'strict', path: '/' };

export interface IssuedCookies {
  accessToken: string;
  csrfToken: string;
  refreshToken: string;
  accessMaxAgeMs: number;
  refreshMaxAgeMs: number;
  deviceKey?: string;
}

export function setSessionCookies(res: Response, c: IssuedCookies): void {
  res.cookie(USER_COOKIES.access, c.accessToken, { ...base, secure: true, httpOnly: true, maxAge: c.accessMaxAgeMs });
  res.cookie(USER_COOKIES.csrf, c.csrfToken, { ...base, secure: true, httpOnly: false, maxAge: c.accessMaxAgeMs });
  res.cookie(REFRESH_COOKIE, c.refreshToken, { ...base, secure: true, httpOnly: true, path: REFRESH_PATH, maxAge: c.refreshMaxAgeMs });
  if (c.deviceKey) res.cookie(DEVICE_COOKIE, c.deviceKey, { ...base, secure: true, httpOnly: true, maxAge: YEAR_MS });
  res.clearCookie(MFA_COOKIE, { ...base, secure: true, httpOnly: true });
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(USER_COOKIES.access, { ...base, secure: true, httpOnly: true });
  res.clearCookie(USER_COOKIES.csrf, { ...base, secure: true, httpOnly: false });
  res.clearCookie(REFRESH_COOKIE, { ...base, secure: true, httpOnly: true, path: REFRESH_PATH });
}

export function setMfaCookie(res: Response, ticket: string, maxAgeMs: number): void {
  res.cookie(MFA_COOKIE, ticket, { ...base, secure: true, httpOnly: true, maxAge: maxAgeMs });
}

// Staff cookies (I-51 a): their own names and refresh path, so a staff session and a user session in one
// browser never overwrite each other. The MFA and enrolment tickets are short-lived, like the user MFA ticket.
export const STAFF_REFRESH_COOKIE = '__Secure-tb_srt';
export const STAFF_REFRESH_PATH = '/api/v1/staff/auth/refresh';
export const STAFF_MFA_COOKIE = '__Host-tb_smfa';
export const STAFF_ENROL_COOKIE = '__Host-tb_senrol';

export function setStaffSessionCookies(res: Response, c: IssuedCookies): void {
  res.cookie(STAFF_COOKIES.access, c.accessToken, { ...base, secure: true, httpOnly: true, maxAge: c.accessMaxAgeMs });
  res.cookie(STAFF_COOKIES.csrf, c.csrfToken, { ...base, secure: true, httpOnly: false, maxAge: c.accessMaxAgeMs });
  res.cookie(STAFF_REFRESH_COOKIE, c.refreshToken, { ...base, secure: true, httpOnly: true, path: STAFF_REFRESH_PATH, maxAge: c.refreshMaxAgeMs });
  res.clearCookie(STAFF_MFA_COOKIE, { ...base, secure: true, httpOnly: true });
  res.clearCookie(STAFF_ENROL_COOKIE, { ...base, secure: true, httpOnly: true });
}

export function clearStaffSessionCookies(res: Response): void {
  res.clearCookie(STAFF_COOKIES.access, { ...base, secure: true, httpOnly: true });
  res.clearCookie(STAFF_COOKIES.csrf, { ...base, secure: true, httpOnly: false });
  res.clearCookie(STAFF_REFRESH_COOKIE, { ...base, secure: true, httpOnly: true, path: STAFF_REFRESH_PATH });
}

export function setStaffTicketCookie(res: Response, name: typeof STAFF_MFA_COOKIE | typeof STAFF_ENROL_COOKIE, ticket: string, maxAgeMs: number): void {
  res.cookie(name, ticket, { ...base, secure: true, httpOnly: true, maxAge: maxAgeMs });
}
