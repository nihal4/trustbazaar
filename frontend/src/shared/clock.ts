// One server clock per tab (section 4.5, FR-AUC-01). Screens that receive serverTime feed it
// (sampleHttp for responses, sampleMessage for live messages); countdowns read serverClock.now().
// One timer per tab ticks once a second for every visible countdown (useServerNow).
import { useEffect, useState } from 'react';
import { ServerClock } from '../lib/time.js';

export const serverClock = new ServerClock();

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (!timer) timer = setInterval(() => listeners.forEach((l) => l()), 1000);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** The server's time now, estimated, updated once a second while the component is shown. */
export function useServerNow(): number {
  const [now, setNow] = useState(() => serverClock.now());
  useEffect(() => subscribe(() => setNow(serverClock.now())), []);
  return now;
}

/** A request whose answer carries serverTime: the answer, with the clock sampled from it. */
export async function withServerTime<R extends { serverTime?: string }>(send: () => Promise<R>): Promise<R> {
  const sentAt = Date.now();
  const r = await send();
  const at = r?.serverTime ? Date.parse(r.serverTime) : NaN;
  if (Number.isFinite(at)) serverClock.sampleHttp(at, sentAt, Date.now());
  return r;
}
