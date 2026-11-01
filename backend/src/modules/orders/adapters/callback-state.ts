import { createHmac, timingSafeEqual } from 'crypto';

// The "signed state" of a browser callback (docs/design/02_orders_payments.pdf section 7.1): an HMAC of the
// attempt id under CALLBACK_STATE_KEY, in the callback URL, so a forged callback cannot name another attempt.
// It proves only which attempt is meant; the payment itself is always confirmed by asking the provider.
export const signState = (key: string, attemptId: string) => createHmac('sha256', key).update(`callback:${attemptId}`).digest('base64url');

export function stateValid(key: string, attemptId: string, state: string | undefined): boolean {
  const expected = Buffer.from(signState(key, attemptId));
  const given = Buffer.from(state ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
