// Leaving the site for a payment provider (docs/design/08_frontend.pdf sections 7.4 and 8.3): only to an exact,
// configured provider host over HTTPS, or to a same-origin path (the mock provider). The host list is a build-time
// value (VITE_PAYMENT_HOSTS); with none configured only the mock's same-origin page is followed.
import { checkProviderRedirect } from '../lib/redirect.js';

const PROVIDER_HOSTS: string[] = (import.meta.env.VITE_PAYMENT_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

/** The provider page to open, or null when it must not be followed. */
export function providerPage(target: string, hosts = PROVIDER_HOSTS, origin = window.location.origin): string | null {
  return checkProviderRedirect(target, hosts, origin)?.href ?? null;
}

/** A full page load to the provider; replaced in the tests. */
export const away = { go: (url: string) => window.location.assign(url) };

/** Section 7.4: the return page checks every 2 s for up to 30 s (NFR-PERF-06 expects about 5 s). */
export const RETURN_POLL_MS = 2_000;
export const RETURN_WAIT_MS = 30_000;
export type Provider = 'bkash' | 'nagad' | 'stripe';

/** The simulated providers' payment page (PAYMENT_MODE=mock): a same-origin path of the backend. The payment sheet plays that page itself. */
export const isMockProviderPage = (target: string, origin = window.location.origin): boolean => {
  try {
    const u = new URL(target, origin);
    return u.pathname.startsWith('/api/v1/mock-provider/');
  } catch {
    return false;
  }
};

/**
 * What the buyer does on the simulated provider's page ("Pay"), done in the app: the same request the page's form sends, then the redirects to the
 * callback, where the server asks the provider what happened (FR-PAY-02: the browser's callback itself proves nothing). Same origin only; the
 * order's own status is read afterwards.
 */
export async function completeMockPayment(target: string, outcome: 'succeeded' | 'failed' = 'succeeded', origin = window.location.origin): Promise<void> {
  const u = new URL(target, origin);
  await fetch(`${origin}${u.pathname}${u.search}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ outcome }).toString(),
    redirect: 'follow',
  });
}
