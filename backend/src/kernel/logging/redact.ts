// The redaction list (docs/design/09_integration.pdf section 8.3; SEC-DAT-07, NFR-OBS-02; K-02). Before a log line is
// written, every field whose key names a secret is replaced, at any depth, and every phone number and e-mail address
// in any string is masked to its last characters. Request and response bodies are never logged at all.

/** Keys (case-insensitive, also as part of a longer key: sessionToken, set-cookie, passwordHash) that are never logged. */
export const REDACTED_KEYS = ['password', 'otp', 'token', 'cookie', 'authorization', 'nid', 'accountnumber', 'ciphertext', 'credentials', 'secret'] as const;
export const REDACTED = '[redacted]';

const MAX_DEPTH = 6;
// E.164 numbers (+8801711000002) and Bangladeshi mobile numbers without the plus (8801711000002, 01711000002); other
// long digit runs, such as times in milliseconds, are left alone
const PHONE = /(?<![\w+])(?:\+\d{10,15}|(?:880|0)1[3-9]\d{8})(?!\w)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const secretKey = (key: string) => {
  const k = key.toLowerCase().replace(/[-_\s]/g, '');
  return REDACTED_KEYS.some((s) => k.includes(s));
};

/** A phone number to its last 3 digits; an e-mail address to the last 2 characters of its name, and its domain. */
export function mask(text: string): string {
  return text
    .replace(EMAIL, (e) => {
      const at = e.lastIndexOf('@');
      return `***${e.slice(Math.max(0, at - 2), at)}${e.slice(at)}`;
    })
    .replace(PHONE, (p) => `***${p.slice(-3)}`);
}

/** A copy of a value fit for a log line: secret keys replaced, strings masked, errors as name, message and stack. */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return mask(value);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[nested]';
  seen.add(value);
  if (value instanceof Error) {
    return { name: value.name, message: mask(value.message), ...(value.stack ? { stack: mask(value.stack) } : {}) };
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));
  if (Buffer.isBuffer(value)) return `[${value.length} bytes]`;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = secretKey(k) ? REDACTED : redact(v, depth + 1, seen);
  return out;
}
