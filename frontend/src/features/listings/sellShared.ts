// What the sell form's parts share: the listing query key and the percentage of an upload.
import { toLocalDigits } from '../../lib/money.js';
import type { Lang } from '../../shared/language/lang';

export const listingKey = (id: string) => ['listings', id, 'own'] as const;

export const percentOf = (bps: number, lang: Lang) => toLocalDigits(String(bps / 100), lang);
