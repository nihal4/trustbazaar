// The answer src/entries/early.ts started for an API path, taken once (NFR-PERF-07; Decisions log, U8-11). Undefined
// when nothing was started for it or it did not succeed; the caller then asks through the API client.
export function takeEarly<T>(path: string): Promise<T | undefined> | undefined {
  const early = (window as unknown as { __tbEarly?: Record<string, Promise<unknown>> }).__tbEarly;
  const answer = early?.[path] as Promise<T | undefined> | undefined;
  if (early && answer) delete early[path];
  return answer;
}
