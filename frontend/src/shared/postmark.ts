import type { Lang } from './language/lang';

/** A day as a postmark shows it: "21 Nov 2026" or "২১ নভে, ২০২৬", in Dhaka. */
export function postmarkDate(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }).format(
    Date.parse(iso),
  );
}
