// TrustBazaar web client - Dhaka time, countdowns and the server clock (Unit 8 reference module).
// NFR-USE-08: every time is shown in Asia/Dhaka with its date; every deadline also as a countdown.
// FR-AUC-01: auction countdowns run on the server's clock, not the device's.

import { toLocalDigits } from './money.js';

export const TZ = 'Asia/Dhaka';

const fmt = {
  en: new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true, numberingSystem: 'latn' }),
  bn: new Intl.DateTimeFormat('bn-BD', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true, numberingSystem: 'beng' }),
};
const hourIn = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' });

/**
 * "Tue 20 Oct 2026, 6:00 pm" / "<U+09AE><U+0999><U+09CD><U+0997><U+09B2> <U+09E8><U+09E6> <U+0985><U+0995><U+09CD><U+099F><U+09CB> <U+09E8><U+09E6><U+09E8><U+09EC>, <U+09EC>:<U+09E6><U+09E6> <U+0985><U+09AA><U+09B0><U+09BE><U+09B9><U+09CD><U+09A3>", always in Dhaka time.
 * The day period is set here rather than taken from the browser, because ICU data differs
 * between browsers (some print "PM" inside Bangla text).
 * @param {number} ms epoch milliseconds @param {'en'|'bn'} lang
 */
export function formatDateTime(ms, lang = 'en') {
  const d = new Date(ms);
  const pm = Number(hourIn.format(d)) >= 12;
  const parts = fmt[lang].formatToParts(d);
  const get = (/** @type {string} */ t) => parts.find((p) => p.type === t)?.value ?? '';
  const period = lang === 'bn' ? (pm ? '<U+0985><U+09AA><U+09B0><U+09BE><U+09B9><U+09CD><U+09A3>' : '<U+09AA><U+09C2><U+09B0><U+09CD><U+09AC><U+09BE><U+09B9><U+09CD><U+09A3>') : pm ? 'pm' : 'am';
  const s = `${get('weekday')} ${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')} ${period}`;
  return toLocalDigits(s, lang);
}

/**
 * Countdown text. Above a day: days and hours; above an hour: hours and minutes; below: m:ss.
 * @param {number} ms remaining milliseconds @param {'en'|'bn'} lang
 * @returns {{text: string, ended: boolean, urgent: boolean}}
 */
export function formatCountdown(ms, lang = 'en') {
  if (ms <= 0) return { text: lang === 'bn' ? '<U+09B6><U+09C7><U+09B7> <U+09B9><U+09AF><U+09BC><U+09C7><U+099B><U+09C7>' : 'Ended', ended: true, urgent: false };
  const s = Math.ceil(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p2 = (/** @type {number} */ n) => String(n).padStart(2, '0');
  let text;
  if (d >= 1) text = lang === 'bn' ? `${d} <U+09A6><U+09BF><U+09A8> ${h} <U+0998><U+09A3><U+09CD><U+099F><U+09BE>` : `${d} ${d === 1 ? 'day' : 'days'} ${h} h`;
  else if (h >= 1) text = lang === 'bn' ? `${h} <U+0998><U+09A3><U+09CD><U+099F><U+09BE> ${p2(m)} <U+09AE><U+09BF><U+09A8><U+09BF><U+099F>` : `${h} h ${p2(m)} min`;
  else text = `${m}:${p2(sec)}`;
  return { text: toLocalDigits(text, lang), ended: false, urgent: s <= 300 };
}

/**
 * A deadline as both a time and a countdown (NFR-USE-08).
 * @param {number} deadlineMs @param {number} nowMs @param {'en'|'bn'} lang
 */
export function formatDeadline(deadlineMs, nowMs, lang = 'en') {
  const when = formatDateTime(deadlineMs, lang);
  const c = formatCountdown(deadlineMs - nowMs, lang);
  if (c.ended) return lang === 'bn' ? `${when} (${c.text})` : `${when} (${c.text})`;
  return lang === 'bn' ? `${when} (<U+0986><U+09B0> ${c.text})` : `${when} (in ${c.text})`;
}

/**
 * Estimates the server's clock from the serverTime field of responses and live messages.
 * Each HTTP sample bounds the offset on both sides: serverTime was read between sending and
 * receiving, so offset is in [serverTime - receivedAt, serverTime - sentAt]. A live message gives
 * only the lower bound, because it may have been delayed. The estimate is the middle of the
 * intersection of the recent samples; if they contradict each other (the device clock jumped),
 * only the newest sample is kept.
 */
export class ServerClock {
  /** @param {{window?: number, now?: () => number}} [o] */
  constructor({ window = 8, now = () => Date.now() } = {}) {
    this.window = window;
    this.local = now;
    /** @type {{lo: number, hi: number}[]} */
    this.samples = [];
    this.estimate = 0;
  }
  /** @param {number} serverTime @param {number} sentAt @param {number} receivedAt */
  sampleHttp(serverTime, sentAt, receivedAt) {
    this.#add({ lo: serverTime - receivedAt, hi: serverTime - sentAt });
  }
  /** @param {number} serverTime @param {number} receivedAt */
  sampleMessage(serverTime, receivedAt) {
    this.#add({ lo: serverTime - receivedAt, hi: Infinity });
  }
  /** @param {{lo: number, hi: number}} s */
  #add(s) {
    this.samples.push(s);
    if (this.samples.length > this.window) this.samples.shift();
    let lo = -Infinity, hi = Infinity;
    for (const x of this.samples) { lo = Math.max(lo, x.lo); hi = Math.min(hi, x.hi); }
    if (lo > hi) { this.samples = [s]; lo = s.lo; hi = s.hi; }
    this.estimate = Number.isFinite(hi) ? (lo + hi) / 2 : lo;
  }
  /** offset in ms to add to the device clock */
  get offset() { return this.estimate; }
  /** the server's current time, estimated */
  now() { return this.local() + this.estimate; }
}
