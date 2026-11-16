import { AsyncLocalStorage } from 'async_hooks';

// The correlation id of the work in progress (K-02): an HTTP request's (kernel/http/correlation.ts), or one given to a
// scheduled job's run, so every log line written on its behalf, in any service, carries it (NFR-OBS-02, SEC-INP-06).
const store = new AsyncLocalStorage<{ correlationId: string }>();

export function withCorrelation<T>(correlationId: string, fn: () => T): T {
  return store.run({ correlationId }, fn);
}

export function currentCorrelationId(): string | undefined {
  return store.getStore()?.correlationId;
}
