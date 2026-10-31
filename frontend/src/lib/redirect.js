// TrustBazaar web client - leaving the site for a payment provider (Unit 8 reference module).
// The backend returns the provider's page to open (Unit 2). The client follows it only to an exact,
// configured provider host over HTTPS, or to a same-origin path (the mock provider in the academic
// deliverable). A changed or injected response therefore cannot send the buyer to a look-alike page.
// The host list comes from the build configuration, filled from Unit 2's adapter settings.

/**
 * @param {string} target the URL from the API
 * @param {string[]} allowedHosts exact host names, e.g. the providers' sandbox hosts
 * @param {string} origin location.origin
 * @returns {URL | null} the URL to navigate to, or null if it must not be followed
 */
export function checkProviderRedirect(target, allowedHosts, origin) {
  let u;
  try { u = new URL(target, origin); } catch { return null; }
  if (u.origin === origin) return u.pathname.startsWith('/') && !u.pathname.startsWith('//') ? u : null;
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== '443') return null;
  return allowedHosts.includes(u.hostname.toLowerCase()) ? u : null;
}
