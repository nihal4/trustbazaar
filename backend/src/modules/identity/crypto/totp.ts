import { createHash } from 'crypto';
import { authenticator } from 'otplib';

// TOTP (RFC 6238; FR-ACC-06; Unit 1 section 6.2): 6 digits, 30-second steps, accepted within one step
// either side of now. checkTotp returns the step the code belongs to, or null; the caller stores it and
// refuses any step not later than the last one used, so a code cannot be used twice.
export const TOTP_STEP_SECONDS = 30;

export function checkTotp(secretBase32: string, code: string, now: Date): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const at = authenticator.clone({ window: 1, step: TOTP_STEP_SECONDS, epoch: now.getTime() });
  const delta = at.checkDelta(code, secretBase32);
  if (delta === null) return null;
  return Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS) + delta;
}

/** Recovery codes are compared ignoring case, spaces and hyphens; only SHA-256 of that form is stored. */
export function hashRecoveryCode(code: string): Buffer {
  return createHash('sha256').update(code.replace(/[\s-]/g, '').toUpperCase()).digest();
}
