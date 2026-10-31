import { readFileSync } from 'fs';
import { join } from 'path';

// Password policy (SEC-AUTH-01, SEC-AUTH-02; Unit 1 section 6.1). Length counts characters (Unicode code
// points after NFC), so a Bangla passphrase counts the letters a person typed. Any printable character,
// including spaces, is accepted; there are no composition rules. A password is refused if it is a common
// or breached password (the bundled list, compared ignoring letter case), or contains a word specific to
// this site or to the person: "trustbazaar", their name, number or e-mail name.
export const MIN_LENGTH_SINGLE_FACTOR = 15;
export const MIN_LENGTH_WITH_MFA = 8;
export const MAX_LENGTH = 256; // DV-8

export type PasswordRefusal = 'too-short' | 'too-long' | 'common' | 'context';

const SITE_WORDS = ['trustbazaar', 'trust bazaar', 'trust-bazaar'];

let blocklist: Set<string> | undefined;
/** The bundled list (crypto/common-passwords.txt); read once. Lines starting with # are comments. */
export function commonPasswords(): Set<string> {
  blocklist ??= new Set(
    readFileSync(join(__dirname, 'common-passwords.txt'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#')),
  );
  return blocklist;
}

const fold = (s: string) => s.normalize('NFKC').toLowerCase();
const length = (s: string) => [...s.normalize('NFC')].length;

export interface PasswordContext {
  displayName?: string;
  phoneE164?: string;
  email?: string;
}

/** The person's own words that a password must not contain: name parts, number, e-mail name (4+ chars). */
function contextWords(c: PasswordContext): string[] {
  const words = [...SITE_WORDS];
  if (c.displayName) words.push(fold(c.displayName).replace(/\s+/g, ''), ...fold(c.displayName).split(/\s+/));
  if (c.phoneE164) words.push(c.phoneE164.replace(/^\+88/, ''), c.phoneE164.slice(-8));
  if (c.email) words.push(fold(c.email.split('@')[0]));
  return words.filter((w) => length(w) >= 4);
}

export function checkPassword(password: string, o: { mfa: boolean; context?: PasswordContext }): PasswordRefusal | null {
  const n = length(password);
  if (n > MAX_LENGTH) return 'too-long';
  if (n < (o.mfa ? MIN_LENGTH_WITH_MFA : MIN_LENGTH_SINGLE_FACTOR)) return 'too-short';
  const p = fold(password);
  if (commonPasswords().has(p) || commonPasswords().has(p.trim())) return 'common';
  const compact = p.replace(/[\s._-]+/g, '');
  if (contextWords(o.context ?? {}).some((w) => p.includes(w) || compact.includes(w.replace(/[\s._-]+/g, '')))) return 'context';
  return null;
}
