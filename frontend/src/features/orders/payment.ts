// Leaving the site for a payment provider (docs/design/08_frontend.pdf sections 7.4 and 8.3): only to an exact,
// configured provider host over HTTPS, or to a same-origin path (the mock provider). The host list is a build-time
// value (VITE_PAYMENT_HOSTS); with none configured only the mock's same-origin page is followed.
import { checkProviderRedirect } from '../../lib/redirect.js';

export const PROVIDER_HOSTS: string[] = (import.meta.env.VITE_PAYMENT_HOSTS ?? '')
  .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);

/** The provider page to open, or null when it must not be followed. */
export function providerPage(target: string, hosts = PROVIDER_HOSTS, origin = window.location.origin): string | null {
  return checkProviderRedirect(target, hosts, origin)?.href ?? null;
}

/** A full page load to the provider; replaced in the tests. */
export const away = { go: (url: string) => window.location.assign(url) };

/** Section 7.4: the return page checks every 2 s for up to 30 s (NFR-PERF-06 expects about 5 s). */
export const RETURN_POLL_MS = 2_000;
export const RETURN_WAIT_MS = 30_000;
export const PROVIDERS = ['bkash', 'nagad', 'stripe'] as const;
export type Provider = (typeof PROVIDERS)[number];
