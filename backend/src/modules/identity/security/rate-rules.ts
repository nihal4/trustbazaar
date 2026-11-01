// The rate-limit rules of Unit 1 section 5.4 (SEC-ABU-01, SEC-ABU-03). A route names its rule with
// @RateLimit(rule); RateLimitGuard applies the limits below, per source address ('ip') or per signed-in
// principal ('principal'). Limits that need the request's content (per account, per phone number, per
// OTP challenge, per session refresh) are applied by the services that know it, with RateLimiter.hit():
//   signin: CP-04, 5 failures per account per 15 min, then DV-10's delay (U1-04)
//   otp-send: CP-05, 3 per number per hour and 10 per day (U1-03)
//   otp-verify: CP-05, 5 per challenge (also in PostgreSQL) and 20 per account per hour (U1-03, U1-04)
//   reset: 3 per account per hour (U1-05);  refresh: 60 per session per hour (U1-04)
export interface Limit {
  per: 'ip' | 'principal';
  limit: number;
  windowSeconds: number;
  /** Read the limit from a parameter instead (ConfigPort, U7-01): get(code)[field]. */
  cp?: { code: string; field: string };
}

export const RATE_RULES: Record<string, Limit[]> = {
  signin: [{ per: 'ip', limit: 50, windowSeconds: 15 * 60 }],
  register: [{ per: 'ip', limit: 5, windowSeconds: 60 * 60 }],
  'otp-send': [{ per: 'ip', limit: 10, windowSeconds: 60 * 60 }],
  'otp-verify': [],
  reset: [{ per: 'ip', limit: 10, windowSeconds: 60 * 60 }],
  token: [{ per: 'ip', limit: 20, windowSeconds: 60 * 60 }],
  refresh: [],
  kyc: [{ per: 'principal', limit: 10, windowSeconds: 24 * 60 * 60 }],
  files: [{ per: 'principal', limit: 120, windowSeconds: 60 * 60 }],
  // CP-35, read from ConfigPort; 60 is only a fallback should the parameter be missing.
  search: [{ per: 'ip', limit: 60, windowSeconds: 60, cp: { code: 'CP-35', field: 'search_per_min' } }],
};
