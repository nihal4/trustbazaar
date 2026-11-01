// Step-up (SEC-AUTH-08; section 4.2): a request declared with a step-up action asks the user for a
// code first. lib/api.js calls `request(action)` and waits for the grant; the shell shows
// <StepUpDialog> for the pending request. The grant is used once and kept only in memory.
import { createContext, useContext, useSyncExternalStore } from 'react';

export interface StepUpRequest {
  action: string;
  resolve: (grant: string) => void;
  reject: (reason: Error) => void;
}

export class StepUpCancelled extends Error {
  constructor() {
    super('step-up cancelled');
    this.name = 'StepUpCancelled';
  }
}

export interface StepUpBroker {
  request: (action: string) => Promise<string>;
  current: () => StepUpRequest | null;
  subscribe: (listener: () => void) => () => void;
}

export function createStepUpBroker(): StepUpBroker {
  let pending: StepUpRequest | null = null;
  const listeners = new Set<() => void>();
  const set = (p: StepUpRequest | null) => {
    pending = p;
    listeners.forEach((l) => l());
  };
  return {
    request: (action) => new Promise<string>((resolve, reject) => {
      pending?.reject(new StepUpCancelled());   // one dialog at a time; a newer action replaces it
      const req: StepUpRequest = {
        action,
        resolve: (grant) => { if (pending === req) set(null); resolve(grant); },
        reject: (reason) => { if (pending === req) set(null); reject(reason); },
      };
      set(req);
    }),
    current: () => pending,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export const StepUpContext = createContext<StepUpBroker | null>(null);

export function usePendingStepUp(): StepUpRequest | null {
  const b = useContext(StepUpContext);
  const noop = () => () => {};
  return useSyncExternalStore(b?.subscribe ?? noop, b?.current ?? (() => null));
}
