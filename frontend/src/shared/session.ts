// "You have been signed out" (section 4.2): set when a refresh is refused or a request is still 401
// after one. The document root clears the query cache at the same moment, so one user's data never
// shows to the next user of a shared phone (section 4.3).
import { createContext, useContext, useSyncExternalStore } from 'react';

export interface SessionNotice {
  signedOut: () => void;
  dismiss: () => void;
  subscribe: (listener: () => void) => () => void;
  isSignedOut: () => boolean;
}

export function createSessionNotice(): SessionNotice {
  let shown = false;
  const listeners = new Set<() => void>();
  const set = (v: boolean) => {
    if (shown === v) return;
    shown = v;
    listeners.forEach((l) => l());
  };
  return {
    signedOut: () => set(true),
    dismiss: () => set(false),
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    isSignedOut: () => shown,
  };
}

export const SessionContext = createContext<SessionNotice | null>(null);

export function useSignedOut(): [boolean, () => void] {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSignedOut outside the document root');
  return [useSyncExternalStore(s.subscribe, s.isSignedOut), s.dismiss];
}
