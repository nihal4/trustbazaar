// The terms and privacy versions a new account accepts (FR-ACC-04). Unit 1 refuses any other value and
// publishes them nowhere yet, so they are build-time values that must equal the backend's
// TERMS_VERSION and PRIVACY_VERSION (both default 2026-11-01). Decisions log, U8-02.
export const LEGAL_VERSIONS = {
  terms: import.meta.env.VITE_TERMS_VERSION || '2026-11-01',
  privacy: import.meta.env.VITE_PRIVACY_VERSION || '2026-11-01',
} as const;
