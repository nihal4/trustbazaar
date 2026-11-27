// The listing editor's data and pure helpers (docs/design/08_frontend.pdf section 7.3; U8-14).
import { parseTaka, toLocalDigits } from '../../lib/money.js';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import type { FieldError } from '../../shared/problems';

/** GET /me/selling-terms (Unit 3; Decisions log, U8-14). */
export interface SellingTerms {
  pro: boolean;
  commissionBps: number;
  auctionDurations: string[];
  photos: { max: number; maxBytes: number; min: number };
  activeListings: { count: number; limit: number };
}
export interface Category {
  id: number;
  parentId: number | null;
  slug: string;
  nameEn: string;
  nameBn: string;
  itemKind: 'physical' | 'game_account';
  selectable: boolean;
}
export interface Area {
  id: number;
  district: string;
  nameEn: string;
  nameBn: string;
  lat: number;
  lng: number;
}

/** GET /listings/{id} as its seller sees it (the own part is the seller's only). */
export interface EditableListing {
  id: string;
  itemKind: 'physical' | 'game_account';
  saleFormat: 'fixed_price' | 'auction';
  status: 'draft' | 'pending_review' | 'active' | 'sold' | 'ended_unsold' | 'cancelled' | 'removed';
  category: { id: number; nameEn: string; nameBn: string };
  title: string;
  description: string;
  condition: string | null;
  noVisibleDefects: boolean;
  fulfilmentOptions: string | null;
  weightClass: string | null;
  sizeClass: string | null;
  price: string | null;
  quantity: { total: number; available: number };
  locked: boolean;
  serialLast4?: string | null;
  photos: { id: string; position: number; url: string; thumbUrl: string; showsDefects: boolean }[];
  clarifications: { id: string; body: string; at: string }[];
  own?: { area: { district: string; lat: number; lng: number } | null; updatedAt: string };
}

/**
 * The commission on one unit at the typed price (CP-25, FR-MON-01), as the payout will show it: whole poisha, rounded
 * down. Null while the price is not a valid amount.
 */
export function commissionOf(price: string, bps: number): bigint | null {
  const p = parseTaka(price);
  if (!p.ok || p.poisha <= 0n) return null;
  return (p.poisha * BigInt(bps)) / 10_000n;
}

/** The area nearest to a position (the device's, IF-SW-08), by straight-line distance; null for an empty list. */
export function nearestArea(areas: Area[], lat: number, lng: number): Area | null {
  let best: Area | null = null;
  let d = Infinity;
  for (const a of areas) {
    const x = (Number(a.lng) - lng) * Math.cos((lat * Math.PI) / 180);
    const y = Number(a.lat) - lat;
    const dd = x * x + y * y;
    if (dd < d) [best, d] = [a, dd];
  }
  return best;
}

/** CP-07's '1 hour', '24 hours', '3 days' in words. */
export function durationLabel(d: string, t: T, lang: Lang): string {
  const m = /^(\d+)\s*(hour|hours|day|days)$/.exec(d.trim());
  if (!m) return d;
  const n = Number(m[1]);
  const key = m[2].startsWith('day') ? (n === 1 ? 'sell.duration.day' : 'sell.duration.days') : n === 1 ? 'sell.duration.hour' : 'sell.duration.hours';
  return t(key, { n: toLocalDigits(String(n), lang) });
}

/** The server's field reasons this screen words; any other is shown with the general message. */
export const REASONS = new Set([
  'required',
  'item-kind',
  'prohibited',
  'unknown',
  'one-of-cp-07',
  'auction-has-bids',
  'order-in-progress',
  'defect-photo-needed',
  'defect-photo-or-declaration',
  'two-needed',
  'auction-sets-start-price-at-publication',
  'single-unit',
  'below-start-price',
  'no-courier-oversize',
  'required-for-courier',
  'no-courier-over-10kg',
  // game accounts (Unit 5)
  'not-offered',
  'fixed-after-proof',
  'game-details-missing',
  'proof-under-review',
  'not-submitted-for-review',
  'type',
  'no-code',
  'code-expired',
  'not-editable',
  'not-for-game-accounts',
  'use-the-ownership-review',
]);
export function reasonTexts(errors: FieldError[], t: T): string[] {
  return errors.map(
    (f) =>
      `${t(FIELDS.has(f.field) ? `sell.field.${f.field}` : 'sell.field.listing')}: ${t(REASONS.has(f.reason) ? `sell.error.${f.reason}` : 'sell.error.invalid')}`,
  );
}
const FIELDS = new Set([
  'area',
  'categoryId',
  'condition',
  'duration',
  'fulfilmentOptions',
  'listing',
  'noVisibleDefects',
  'photo',
  'photos',
  'price',
  'quantity',
  'reservePrice',
  'sizeClass',
  'startPrice',
  'weightClass',
  'title',
  'description',
  'gameId',
  'platform',
  'playerId',
  'contents',
  'file',
  'code',
]);
