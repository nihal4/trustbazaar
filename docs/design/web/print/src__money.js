// TrustBazaar web client - money display and input (Unit 8 reference module).
// Amounts travel as integer poisha (1 taka = 100 poisha) and are never held as fractional numbers.
// Display: taka sign first, lakh grouping (12,34,567), Bangla digits in Bangla (NFR-USE-04).

const BN = '<U+09E6><U+09E7><U+09E8><U+09E9><U+09EA><U+09EB><U+09EC><U+09ED><U+09EE><U+09EF>';
const MAX_POISHA = 10n ** 13n;            // BDT 100 billion: a sanity bound only; business limits are the server's

/** @param {string} s @param {'en'|'bn'} lang */
export function toLocalDigits(s, lang) {
  return lang === 'bn' ? s.replace(/[0-9]/g, (d) => BN[Number(d)]) : s;
}

/** Bangla digits to ASCII; other characters unchanged. @param {string} s */
export function toAsciiDigits(s) {
  return s.replace(/[\u09E6-\u09EF]/g, (c) => String(BN.indexOf(c)));
}

/** @param {string} digits */
function groupLakh(digits) {
  if (digits.length <= 3) return digits;
  let rest = digits.slice(0, -3);
  const parts = [digits.slice(-3)];
  while (rest.length > 2) { parts.unshift(rest.slice(-2)); rest = rest.slice(0, -2); }
  if (rest) parts.unshift(rest);
  return parts.join(',');
}

/** @param {bigint|number|string} v */
function toPoisha(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new RangeError('poisha must be a safe integer');
    return BigInt(v);
  }
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return BigInt(v);
  throw new TypeError('poisha must be an integer');
}

/**
 * Format an amount in poisha.
 * decimals 'auto' drops ".00" (single prices); 'always' keeps two decimals (breakdowns, receipts).
 * @param {bigint|number|string} poisha
 * @param {'en'|'bn'} [lang]
 * @param {{decimals?: 'auto'|'always', sign?: boolean}} [opts]
 */
export function formatMoney(poisha, lang = 'en', { decimals = 'auto', sign = false } = {}) {
  const p = toPoisha(poisha);
  const neg = p < 0n;
  const a = neg ? -p : p;
  const paisa = (a % 100n).toString().padStart(2, '0');
  let s = '<U+09F3>' + groupLakh((a / 100n).toString());
  if (decimals === 'always' || paisa !== '00') s += '.' + paisa;
  s = toLocalDigits(s, lang);
  return (neg ? '<U+2212>' : sign && p > 0n ? '+' : '') + s;
}

/**
 * Parse what a user typed as a taka amount (bid, price, partial refund) into poisha.
 * Accepts ASCII or Bangla digits, group commas, an optional taka sign, "Tk" or "BDT", and up to
 * two decimals. Never goes through a floating-point number.
 * @param {string} input
 * @returns {{ok: true, poisha: bigint} | {ok: false, reason: 'empty'|'format'|'decimals'|'too_large'}}
 */
export function parseTaka(input) {
  let s = toAsciiDigits(String(input)).trim().replace(/^(<U+09F3>|tk\.?|bdt)\s*/i, '').replace(/\s+/g, '');
  if (s === '') return { ok: false, reason: 'empty' };
  if (/^\d+\.\d{3,}$/.test(s.replace(/,/g, ''))) return { ok: false, reason: 'decimals' };
  // commas only as separators between digit groups (both 1,234,567 and 12,34,567 are accepted)
  if (!/^\d{1,3}(,\d{2,3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(s)) return { ok: false, reason: 'format' };
  s = s.replace(/,/g, '');
  const [whole, frac = ''] = s.split('.');
  const poisha = BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
  if (poisha >= MAX_POISHA) return { ok: false, reason: 'too_large' };
  return { ok: true, poisha };
}
