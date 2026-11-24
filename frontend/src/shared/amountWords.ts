// The amount in words, as written on a money order or a cheque in Bangladesh (docs/design/10_visual_v2.md, section 6
// and AC-ORD-1): the South Asian scale (hundred, thousand, lakh, crore), "taka", the poisha if any, and "only".
// English: "One lakh twenty-five thousand three hundred and fifty taka and fifty poisha only".
// Bangla:  "এক লাখ পঁচিশ হাজার তিন শত পঞ্চাশ টাকা পঞ্চাশ পয়সা মাত্র".
// Amounts arrive as integer poisha (lib/money.js) and never pass through a floating-point number.
import type { Lang } from './language/lang';

const EN_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** 1 to 99 in Bangla: the names are not regular, so each has its own word. */
const BN_1_99 = ['', 'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়', 'দশ',
  'এগারো', 'বারো', 'তেরো', 'চৌদ্দ', 'পনেরো', 'ষোলো', 'সতেরো', 'আঠারো', 'উনিশ', 'বিশ',
  'একুশ', 'বাইশ', 'তেইশ', 'চব্বিশ', 'পঁচিশ', 'ছাব্বিশ', 'সাতাশ', 'আটাশ', 'উনত্রিশ', 'ত্রিশ',
  'একত্রিশ', 'বত্রিশ', 'তেত্রিশ', 'চৌত্রিশ', 'পঁয়ত্রিশ', 'ছত্রিশ', 'সাঁইত্রিশ', 'আটত্রিশ', 'উনচল্লিশ', 'চল্লিশ',
  'একচল্লিশ', 'বিয়াল্লিশ', 'তেতাল্লিশ', 'চুয়াল্লিশ', 'পঁয়তাল্লিশ', 'ছেচল্লিশ', 'সাতচল্লিশ', 'আটচল্লিশ', 'উনপঞ্চাশ', 'পঞ্চাশ',
  'একান্ন', 'বাহান্ন', 'তিপ্পান্ন', 'চুয়ান্ন', 'পঞ্চান্ন', 'ছাপ্পান্ন', 'সাতান্ন', 'আটান্ন', 'উনষাট', 'ষাট',
  'একষট্টি', 'বাষট্টি', 'তেষট্টি', 'চৌষট্টি', 'পঁয়ষট্টি', 'ছেষট্টি', 'সাতষট্টি', 'আটষট্টি', 'উনসত্তর', 'সত্তর',
  'একাত্তর', 'বাহাত্তর', 'তিয়াত্তর', 'চুয়াত্তর', 'পঁচাত্তর', 'ছিয়াত্তর', 'সাতাত্তর', 'আটাত্তর', 'উনআশি', 'আশি',
  'একাশি', 'বিরাশি', 'তিরাশি', 'চুরাশি', 'পঁচাশি', 'ছিয়াশি', 'সাতাশি', 'আটাশি', 'উননব্বই', 'নব্বই',
  'একানব্বই', 'বিরানব্বই', 'তিরানব্বই', 'চুরানব্বই', 'পঁচানব্বই', 'ছিয়ানব্বই', 'সাতানব্বই', 'আটানব্বই', 'নিরানব্বই'];

const WORDS = {
  en: {
    below100: (n: number) => (n < 20 ? EN_ONES[n] : EN_TENS[Math.floor(n / 10)] + (n % 10 ? '-' + EN_ONES[n % 10] : '')),
    hundred: 'hundred', thousand: 'thousand', lakh: 'lakh', crore: 'crore', and: 'and',
    zero: 'zero', taka: 'taka', poisha: (p: string) => `and ${p} poisha`, only: 'only',
  },
  bn: {
    below100: (n: number) => BN_1_99[n],
    hundred: 'শত', thousand: 'হাজার', lakh: 'লাখ', crore: 'কোটি', and: '',
    zero: 'শূন্য', taka: 'টাকা', poisha: (p: string) => `${p} পয়সা`, only: 'মাত্র',
  },
};

/** A whole number of taka in words on the South Asian scale; crores repeat for amounts of 100 crore and more. */
function count(n: bigint, lang: Lang): string {
  const w = WORDS[lang];
  const parts: string[] = [];
  const crore = n / 10_000_000n;
  let rest = n % 10_000_000n;
  if (crore > 0n) parts.push(count(crore, lang), w.crore);
  const lakh = rest / 100_000n; rest %= 100_000n;
  const thousand = rest / 1_000n; rest %= 1_000n;
  const hundred = rest / 100n; rest %= 100n;
  if (lakh > 0n) parts.push(w.below100(Number(lakh)), w.lakh);
  if (thousand > 0n) parts.push(w.below100(Number(thousand)), w.thousand);
  if (hundred > 0n) parts.push(w.below100(Number(hundred)), w.hundred);
  if (rest > 0n) {
    if (parts.length > 0 && w.and) parts.push(w.and);
    parts.push(w.below100(Number(rest)));
  }
  return parts.join(' ');
}

/** The amount in poisha in words, in the page's language; negative amounts are not money-order amounts. */
export function amountInWords(poisha: bigint | string, lang: Lang): string {
  const p = typeof poisha === 'bigint' ? poisha : BigInt(poisha);
  if (p < 0n) throw new RangeError('amountInWords takes amounts of zero or more');
  const w = WORDS[lang];
  const taka = p / 100n;
  const paisa = Number(p % 100n);
  const words = [taka > 0n ? count(taka, lang) : w.zero, w.taka];
  if (paisa > 0) words.push(w.poisha(w.below100(paisa)));
  words.push(w.only);
  const text = words.join(' ');
  return lang === 'en' ? text[0].toUpperCase() + text.slice(1) : text;
}
