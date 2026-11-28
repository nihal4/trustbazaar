// What the details form of a listing checks before it sends, and the body it sends (kept out of the component so each part is small).
import { parseTaka } from '../../lib/money.js';
import { errorText } from '../../shared/errors';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { problemName } from '../../shared/problems';
import type { Area } from './sell';

export interface DetailsValues {
  /** a new listing, or a draft whose category can still be chosen */
  draft: boolean;
  isNew: boolean;
  game: boolean;
  courier: boolean;
  saleFormat: 'fixed_price' | 'auction';
  itemKind: 'physical' | 'game_account';
  categoryId: string;
  title: string;
  description: string;
  condition: string;
  noDefects: boolean;
  serial: string;
  fulfilment: string;
  weight: string;
  size: string;
  price: string;
  quantity: string;
  area: Area | null;
  located: { lat: number; lng: number } | null;
}

/** The sentences for what is missing or wrong, and the price in poisha once it is right (null for an auction). */
export function detailsProblems(v: DetailsValues, t: T): { problems: string[]; poisha: bigint | null } {
  const problems: string[] = [];
  const fixed = v.saleFormat === 'fixed_price';
  if (v.draft && !v.categoryId) problems.push(t('sell.need.category'));
  if (v.title.trim().length < 5) problems.push(t('sell.need.title'));
  if (v.description.trim().length < 20) problems.push(t('sell.need.description'));
  if (!v.game && !v.condition) problems.push(t('sell.need.condition'));
  if (v.courier && (!v.weight || !v.size)) problems.push(t('sell.need.parcel'));
  let poisha: bigint | null = null;
  if (fixed) {
    const p = parseTaka(v.price);
    if (!p.ok || p.poisha <= 0n) problems.push(t('sell.need.price'));
    else poisha = p.poisha;
  }
  const q = Number(v.quantity);
  if (fixed && !v.game && !(Number.isInteger(q) && q >= 1 && q <= 9999)) problems.push(t('sell.need.quantity'));
  if (v.isNew && !v.game && !v.area) problems.push(t('sell.need.area'));
  if (v.serial.trim() !== '' && !/^[A-Z0-9]{6,30}$/.test(v.serial.replace(/[\s-]/g, '').toUpperCase())) problems.push(t('sell.need.serial'));
  return { problems, poisha };
}

/** The body of the save: only what applies to this kind of listing. */
export function detailsBody(v: DetailsValues, poisha: bigint | null): Record<string, unknown> {
  const physical = v.game
    ? {}
    : {
        condition: v.condition,
        noVisibleDefects: v.noDefects,
        ...(v.serial.trim() !== '' ? { serial: v.serial.trim() } : {}),
        fulfilmentOptions: v.fulfilment,
        weightClass: v.courier ? v.weight : null,
        sizeClass: v.courier ? v.size : null,
      };
  const { area, located } = v;
  return {
    ...(v.draft ? { categoryId: Number(v.categoryId) } : {}),
    title: v.title.trim(),
    description: v.description.trim(),
    ...physical,
    ...(v.saleFormat === 'fixed_price' ? { price: String(poisha), quantity: v.game ? 1 : Number(v.quantity) } : {}),
    ...(area && !v.game ? { area: { district: area.district, lat: located?.lat ?? area.lat, lng: located?.lng ?? area.lng } } : {}),
    ...(v.isNew ? { itemKind: v.itemKind, saleFormat: v.saleFormat } : {}),
  };
}

/** The line above the form when a save is refused: the listing changed under the person, nothing (the field reasons say it all), or what the error says. */
export function refusedMessage(e: unknown, hasFieldReasons: boolean, t: T, lang: Lang): string | null {
  if (problemName(e) === 'listing-state') return t('sell.changed');
  return hasFieldReasons ? null : errorText(e, t, lang);
}
