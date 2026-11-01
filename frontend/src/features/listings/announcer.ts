// Screen-reader announcements for the auction panel (section 7.3, NFR-USE-02): price changes in a polite live
// region at most every 5 seconds, the newest one winning; an outbid notice at once.
import { useCallback, useEffect, useRef, useState } from 'react';

export const ANNOUNCE_GAP_MS = 5_000;

export function useAnnouncer(gap = ANNOUNCE_GAP_MS) {
  const [text, setText] = useState('');
  const last = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef('');
  useEffect(() => () => {
    if (pending.current) clearTimeout(pending.current);
  }, []);

  const say = useCallback((message: string, now = false) => {
    latest.current = message;
    const wait = last.current + gap - Date.now();
    if (now || wait <= 0) {
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
      last.current = Date.now();
      setText(message);
      return;
    }
    if (pending.current) return; // the newest message is sent when the gap ends
    pending.current = setTimeout(() => {
      pending.current = null;
      last.current = Date.now();
      setText(latest.current);
    }, wait);
  }, [gap]);

  return { text, say };
}
