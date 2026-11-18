// What every credential screen is given (U8-07). The key store is Unit 5's sealed.js (IndexedDB of this browser);
// tests pass one in memory.
import { ApiError } from '../lib/api.js';
import type { createApi } from '../lib/api.js';

export type Lang = 'en' | 'bn';
export type T = (key: string, vars?: Record<string, string>) => string;
export type Api = ReturnType<typeof createApi>;
export interface KeyStore {
  store(orderId: string, version: number, pair: CryptoKeyPair): Promise<void>;
  load(orderId: string, version: number): Promise<CryptoKeyPair | null>;
}
export interface Ctx { api: Api; t: T; lang: Lang; orderId: string; root: HTMLElement; keys: KeyStore; now: () => number }

export type HandoverStatus = 'preparing' | 'awaiting_credentials' | 'delivered' | 'rekey_requested' | 'disputed' | 'taken_over' | 'cancelled' | 'closed';
export const STEPS = ['password', 'recovery_email', 'recovery_phone', 'social_logins', 'two_step'] as const;
export type Step = (typeof STEPS)[number];
export interface GameView {
  orderId: string; role: 'buyer' | 'seller';
  disclosure: { currentVersion: number; acknowledgedVersion: number | null; acknowledgedAt: string | null };
  status: HandoverStatus | null; keyVersion: number; rekeysUsed: number;
  credentialsDueAt: string | null; deliveredAt: string | null; takeoverDueAt: string | null; rekeyDueAt: string | null;
  takenOverAt: string | null; steps: Record<Step, string | null>; protectionEndsAt: string | null;
}
/** What the seller's browser seals (Unit 5 section 5: login identifier, password, recovery codes, a note). */
export interface Credentials { loginId: string; password: string; recovery: string[]; note: string }

export const gamePath = (orderId: string, rest = '') => `/orders/${encodeURIComponent(orderId)}/game${rest}`;
export const orderLink = (orderId: string) => `/orders/${encodeURIComponent(orderId)}`;

/** The server's refusals these screens put in words; anything else is the general text of lib/api.js. */
const REASONS = new Set([
  'credentials-not-expected', 'deadline-passed', 'stale-key-version', 'none', 'key-fixed', 'not-acknowledged', 'not-a-p256-point',
  'takeover-not-in-progress', 'window-ended', 'recovery-email-confirmed', 'rekey-used',
]);
export function errorText(e: unknown, t: T): string {
  if (!(e instanceof ApiError)) return t('error.generic');
  if (e.type.endsWith('/feature-off')) return t('secure.error.feature-off');
  const reason = Array.isArray(e.errors) ? (e.errors as { reason?: string }[]).map((x) => x.reason).find((r) => r && REASONS.has(r)) : undefined;
  return reason ? t(`secure.error.${reason}`) : t(e.messageKey);
}
export const reasonOf = (e: unknown) =>
  e instanceof ApiError && Array.isArray(e.errors) ? ((e.errors as { reason?: string }[])[0]?.reason ?? null) : null;
