// Card brand detection for the payment sheet (U10-23). The simulated payment accepts any card details, but the sheet still tells the buyer which kind of
// card the number looks like, from its first digits (the issuer ranges), and shapes the number, the security code and their lengths to that brand. Nothing
// here validates a real card, and nothing typed in the sheet is ever sent or stored (no real money moves; PCI is out of scope).

type CardBrandId = 'visa' | 'mastercard' | 'amex' | 'discover' | 'diners' | 'jcb' | 'unionpay' | 'rupay' | 'maestro' | 'unknown';

export interface CardBrand {
  id: CardBrandId;
  label: string;
  /** the digit groups the number is shown in, such as [4, 4, 4, 4] */
  groups: number[];
  /** the security code length */
  cvc: number;
}

const BRANDS: Record<CardBrandId, CardBrand> = {
  visa: { id: 'visa', label: 'Visa', groups: [4, 4, 4, 4], cvc: 3 },
  mastercard: { id: 'mastercard', label: 'Mastercard', groups: [4, 4, 4, 4], cvc: 3 },
  amex: { id: 'amex', label: 'American Express', groups: [4, 6, 5], cvc: 4 },
  discover: { id: 'discover', label: 'Discover', groups: [4, 4, 4, 4], cvc: 3 },
  diners: { id: 'diners', label: 'Diners Club', groups: [4, 6, 4], cvc: 3 },
  jcb: { id: 'jcb', label: 'JCB', groups: [4, 4, 4, 4], cvc: 3 },
  unionpay: { id: 'unionpay', label: 'UnionPay', groups: [4, 4, 4, 4], cvc: 3 },
  rupay: { id: 'rupay', label: 'RuPay', groups: [4, 4, 4, 4], cvc: 3 },
  maestro: { id: 'maestro', label: 'Maestro', groups: [4, 4, 4, 4], cvc: 3 },
  unknown: { id: 'unknown', label: '', groups: [4, 4, 4, 4], cvc: 3 },
};

const num = (s: string, from: number, to: number): number => Number(s.slice(from, to));

/** The brand a card number looks like, from the digits typed so far (an empty or unrecognised start gives 'unknown'). */
export function detectBrand(input: string): CardBrand {
  const d = input.replace(/\D/g, '');
  if (d.length === 0) return BRANDS.unknown;
  const p2 = d.length >= 2 ? num(d, 0, 2) : -1;
  const p3 = d.length >= 3 ? num(d, 0, 3) : -1;
  const p4 = d.length >= 4 ? num(d, 0, 4) : -1;
  if (d[0] === '4') return BRANDS.visa;
  if (p2 === 34 || p2 === 37) return BRANDS.amex;
  if ((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) return BRANDS.mastercard;
  if (p4 === 6011 || (p3 >= 644 && p3 <= 649) || p2 === 65) return BRANDS.discover;
  if (p4 >= 3528 && p4 <= 3589) return BRANDS.jcb;
  if (p3 >= 300 && p3 <= 305) return BRANDS.diners;
  if (p2 === 36 || p2 === 38 || p2 === 39) return BRANDS.diners;
  if (p2 === 62) return BRANDS.unionpay;
  if (p2 === 60 || p2 === 81 || p2 === 82) return BRANDS.rupay;
  if (p2 === 50 || (p2 >= 56 && p2 <= 69)) return BRANDS.maestro;
  return BRANDS.unknown;
}

/** The digits of a card number, at most 19, grouped for the brand ("4242 4242 4242 4242"). */
export function formatCardNumber(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 19);
  const groups = detectBrand(d).groups;
  const out: string[] = [];
  let at = 0;
  for (const g of groups) {
    if (at >= d.length) break;
    out.push(d.slice(at, at + g));
    at += g;
  }
  if (at < d.length) out.push(d.slice(at));
  return out.join(' ');
}

/** "12/29" from "1229" as the buyer types; a month above 12 is not shaped, only cut. */
export function formatExpiry(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

/** The sheet accepts any card whose number has 12 or more digits, a month from 01 to 12 and a code of the brand's length. */
export function cardLooksComplete(number: string, expiry: string, cvc: string): boolean {
  const d = number.replace(/\D/g, '');
  const month = Number(expiry.slice(0, 2));
  return d.length >= 12 && /^\d{2}\/\d{2}$/.test(expiry) && month >= 1 && month <= 12 && cvc.replace(/\D/g, '').length === detectBrand(d).cvc;
}

/** The last four digits, for "Visa ending 4242"; never more of the number. */
export const lastFour = (number: string): string => number.replace(/\D/g, '').slice(-4);

/** A wallet number as the sheet accepts it: 11 digits starting 01 (bKash and Nagad). */
export const walletLooksValid = (n: string): boolean => /^01\d{9}$/.test(n.replace(/\D/g, ''));

/** "01•••••678": the wallet number with all but the first two and the last three digits hidden. */
export function maskWallet(n: string): string {
  const d = n.replace(/\D/g, '');
  return d.length <= 5 ? d : `${d.slice(0, 2)}${'•'.repeat(d.length - 5)}${d.slice(-3)}`;
}
