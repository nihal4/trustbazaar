import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** E.164 for a Bangladeshi mobile number (+8801[3-9]XXXXXXXX), or null (FR-ACC-01). */
export function bangladeshiMobile(input: string): string | null {
  const p = parsePhoneNumberFromString(input.trim(), 'BD');
  return p?.isValid() && /^\+8801[3-9]\d{8}$/.test(p.number) ? p.number : null;
}
