// TrustBazaar web client - the order's money in plain language (Unit 8 reference module).
// NFR-USE-07: the order view says where the money is, who gets it, when, and what can stop it.
// The function picks a message and its values; the screen renders it with the catalogue.

import { formatMoney } from './money.js';
import { formatDateTime } from './time.js';

/**
 * @typedef {object} OrderMoneyView  fields of GET /orders/{id} (Unit 2)
 * @property {'awaiting_payment'|'cancelled'|'paid'|'closed'} status
 * @property {'held'|'frozen_disputed'|'released'|'refunded'|'partially_refunded'|null} escrowState
 * @property {'standard'|'game_protection'} releasePolicy
 * @property {number} total                 poisha the buyer pays or paid
 * @property {number} [refunded]            poisha refunded so far
 * @property {number} [paymentDueAt]
 * @property {number} [fulfilmentDueAt]
 * @property {number|null} [deliveryEventAt]
 * @property {number|null} [autoReleaseAt]  for game accounts: the end of the protection period
 * @property {number|null} [closedAt]
 */

/**
 * @param {OrderMoneyView} o @param {'buyer'|'seller'} role
 * @returns {{key: string, vars: Record<string, {money: number} | {time: number}>}}
 */
export function describeMoney(o, role) {
  const k = (/** @type {string} */ s) => `money.${s}.${role}`;
  if (o.status === 'awaiting_payment') return { key: k('awaiting_payment'), vars: { due: { time: o.paymentDueAt ?? 0 } } };
  if (o.status === 'cancelled') return { key: k('cancelled_unpaid'), vars: {} };
  switch (o.escrowState) {
    case 'held':
      if (!o.deliveryEventAt) {
        return { key: k('held_before_delivery'), vars: { amount: { money: o.total }, due: { time: o.fulfilmentDueAt ?? 0 } } };
      }
      if (o.releasePolicy === 'game_protection') {
        return { key: k('held_protection'), vars: { at: { time: o.autoReleaseAt ?? 0 } } };
      }
      return { key: k('held_after_delivery'), vars: { at: { time: o.autoReleaseAt ?? 0 } } };
    case 'frozen_disputed':
      return { key: k('frozen'), vars: { amount: { money: o.total } } };
    case 'released':
      return { key: k('released'), vars: { amount: { money: o.total }, at: { time: o.closedAt ?? 0 } } };
    case 'refunded':
      return { key: k('refunded'), vars: { amount: { money: o.refunded ?? o.total }, at: { time: o.closedAt ?? 0 } } };
    case 'partially_refunded':
      return { key: k('partially_refunded'), vars: { amount: { money: o.refunded ?? 0 }, at: { time: o.closedAt ?? 0 } } };
    default:
      throw new Error(`unknown escrow state ${o.escrowState}`);
  }
}

/**
 * @param {(key: string, vars?: Record<string, string>) => string} t
 * @param {{key: string, vars: Record<string, {money: number} | {time: number}>}} d
 * @param {'en'|'bn'} lang
 */
export function renderMoney(t, d, lang) {
  /** @type {Record<string, string>} */
  const vars = {};
  for (const [name, v] of Object.entries(d.vars)) {
    vars[name] = 'money' in v ? formatMoney(v.money, lang) : formatDateTime(v.time, lang);
  }
  return t(d.key, vars);
}

/** every key describeMoney can return, for the catalogue test */
export const MONEY_KEYS = ['awaiting_payment', 'cancelled_unpaid', 'held_before_delivery', 'held_protection',
  'held_after_delivery', 'frozen', 'released', 'refunded', 'partially_refunded']
  .flatMap((s) => [`money.${s}.buyer`, `money.${s}.seller`]);
