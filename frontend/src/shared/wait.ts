// How a wait is written everywhere (U10-25): one standard for every countdown on a button, every "try again in" and every answer to a 429, so a person
// never meets a raw count of seconds. Up to two minutes it counts in seconds ("75 s"); up to ten minutes in minutes and seconds ("9 min 5 s"); up to an
// hour in whole minutes, rounded up ("34 min"); beyond that in hours and minutes ("1 h 5 min"). Figures are in the page's digits; Bangla names its units.
import { toLocalDigits } from '../lib/money.js';
import type { Lang } from './language/lang';

const UNITS = {
  en: { s: 's', min: 'min', h: 'h' },
  bn: { s: 'সেকেন্ড', min: 'মিনিট', h: 'ঘণ্টা' },
} as const;

export function formatWait(seconds: number, lang: Lang): string {
  const total = Math.max(1, Math.ceil(Number.isFinite(seconds) ? seconds : 1));
  const u = UNITS[lang === 'bn' ? 'bn' : 'en'];
  const n = (v: number) => toLocalDigits(String(v), lang);
  if (total <= 120) return `${n(total)} ${u.s}`;
  if (total < 600) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return s === 0 ? `${n(m)} ${u.min}` : `${n(m)} ${u.min} ${n(s)} ${u.s}`;
  }
  const minutes = Math.ceil(total / 60);
  if (minutes < 60) return `${n(minutes)} ${u.min}`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${n(h)} ${u.h}` : `${n(h)} ${u.h} ${n(m)} ${u.min}`;
}
