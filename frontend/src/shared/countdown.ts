// Waiting times shown as a countdown: a Retry-After after 429, or the gap before a new code may be sent.
// These are short relative waits, so they run on the device clock from the moment the answer arrived;
// deadlines that matter (auctions, payment windows) use serverClock instead (section 4.5).
import { useEffect, useState } from 'react';

export const untilAfter = (seconds: number, now = Date.now()) => now + Math.max(0, seconds) * 1000;

/**
 * A server time such as `resendAt`, turned into a local end time. The wait is measured from the
 * answer; it is capped so a wrong device clock cannot lock a button for long (the server still
 * answers 429 with Retry-After if the user is early).
 */
export function untilServerTime(iso: string, now = Date.now(), capSeconds = 120): number {
  const ms = Date.parse(iso) - now;
  return now + Math.min(Math.max(0, Number.isFinite(ms) ? ms : 0), capSeconds * 1000);
}

const secondsUntil = (until: number | null) => (until === null ? 0 : Math.max(0, Math.ceil((until - Date.now()) / 1000)));

/**
 * Whole seconds left until `until` (ms since the epoch); 0 when passed. The value is worked out on
 * every render, so it is right from the first render after `until` changes (a button never shows as
 * free for a moment before its wait begins); the timer only asks for a new render each second.
 */
export function useSecondsLeft(until: number | null): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (until === null || secondsUntil(until) === 0) return;
    const id = setInterval(() => {
      setTick((n) => n + 1);
      if (secondsUntil(until) === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [until]);
  return secondsUntil(until);
}
