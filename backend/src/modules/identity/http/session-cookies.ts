import type { CookieOptions, Response } from 'express';
import { USER_COOKIES } from '../security/cookies';

// The user's cookies (Unit 1 section 7.1). All are Secure and SameSite=Strict; only the CSRF cookie is
// readable by the page, which copies it into X-CSRF-Token. The refresh cookie is sent only to the refresh
// path. No token is ever put in a URL, a response body or browser storage (SEC-SES-03).
export const REFRESH_COOKIE = '__Secure-tb_rt';
export const REFRESH_PATH = '/api/v1/auth/refresh';
export const MFA_COOKIE = '__Host-tb_mfa';
export const DEVICE_COOKIE = '__Host-tb_dev';
const YEAR_MS = 365 * 24 * 3600 * 1000;

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
  res.cookie(USER_COOKIES.access, c.accessToken, { ...base, httpOnly: true, maxAge: c.accessMaxAgeMs });
  res.cookie(USER_COOKIES.csrf, c.csrfToken, { ...base, httpOnly: false, maxAge: c.accessMaxAgeMs });
  res.cookie(REFRESH_COOKIE, c.refreshToken, { ...base, httpOnly: true, path: REFRESH_PATH, maxAge: c.refreshMaxAgeMs });
  if (c.deviceKey) res.cookie(DEVICE_COOKIE, c.deviceKey, { ...base, httpOnly: true, maxAge: YEAR_MS });
  res.clearCookie(MFA_COOKIE, { ...base, httpOnly: true });
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(USER_COOKIES.access, { ...base, httpOnly: true });
  res.clearCookie(USER_COOKIES.csrf, { ...base, httpOnly: false });
  res.clearCookie(REFRESH_COOKIE, { ...base, httpOnly: true, path: REFRESH_PATH });
}

export function setMfaCookie(res: Response, ticket: string, maxAgeMs: number): void {
  res.cookie(MFA_COOKIE, ticket, { ...base, httpOnly: true, maxAge: maxAgeMs });
}
