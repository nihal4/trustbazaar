// NFR-USE-07 (docs/design/08_frontend.pdf section 8.2): where the money is, in one sentence, from lib/moneyState.js
// and the reference catalogue, filled with the order's amounts and Dhaka times.
import { formatMoney } from '../../lib/money.js';
import { describeMoney } from '../../lib/moneyState.js';
import { formatDateTime } from '../../lib/time.js';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import type { OrderView } from './model';

/** NFR-USE-07: where the money is, in one sentence (lib/moneyState.js and the reference catalogue). */
export function moneyText(o: OrderView, t: T, lang: Lang): string {
  const ms = (s: string | null) => (s ? Date.parse(s) : null);
  const d = describeMoney({
    status: o.status, escrowState: o.escrow?.state ?? null, releasePolicy: o.escrow?.releasePolicy ?? 'standard',
    total: Number(o.total), refunded: Number(o.escrow?.amountRefunded ?? 0), paymentDueAt: ms(o.paymentDueAt) ?? 0,
    fulfilmentDueAt: ms(o.fulfilmentDueAt) ?? 0, deliveryEventAt: ms(o.deliveryEventAt), autoReleaseAt: ms(o.escrow?.autoReleaseAt ?? null), closedAt: ms(o.closedAt),
  }, o.role);
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.vars)) vars[k] = 'money' in v ? formatMoney(BigInt(v.money), lang) : formatDateTime(v.time, lang);
  return t(d.key, vars);
}

