import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createT, placeholders } from '../src/i18n.js';
import { describeMoney, renderMoney, MONEY_KEYS } from '../src/moneyState.js';

const load = (l) => JSON.parse(readFileSync(new URL(`../src/messages/${l}.json`, import.meta.url), 'utf8'));
const en = load('en'), bn = load('bn');

test('NFR-USE-04 both catalogues have the same messages', () => {
  assert.deepEqual(Object.keys(bn).sort(), Object.keys(en).sort());
});

test('each message has the same placeholders in both languages', () => {
  for (const k of Object.keys(en)) assert.deepEqual(placeholders(bn[k]), placeholders(en[k]), k);
});

test('Bangla messages are written in Bangla, with Bangla digits', () => {
  for (const [k, v] of Object.entries(bn)) {
    assert.match(v, /[ঀ-৿]/, k);
    assert.doesNotMatch(v.replace(/\{\w+\}/g, ''), /[0-9]/, k);
  }
});

test('SEC-INP-03 no message contains markup', () => {
  for (const c of [en, bn]) for (const [k, v] of Object.entries(c)) assert.doesNotMatch(v, /[<>]/, k);
});

test('IF-UI-10 every irreversible action has a consequence message', () => {
  for (const a of ['confirm_receipt', 'release_early', 'open_dispute', 'withdraw_dispute', 'seller_cancel',
    'place_bid', 'proxy_bid', 'buy_now', 'share_handover_code']) assert.ok(en[`confirm.${a}`], a);
});

test('every message the money-state function can pick exists in both catalogues', () => {
  for (const k of MONEY_KEYS) { assert.ok(en[k], k); assert.ok(bn[k], k); }
});

test('strict mode catches a missing key or variable', () => {
  const t = createT(en, { strict: true });
  assert.throws(() => t('no.such.key'), /missing message/);
  assert.throws(() => t('error.generic'), /needs \{ref\}/);
  assert.equal(t('error.generic', { ref: 'c-123' }), 'Something went wrong on our side. If you contact us, quote reference c-123.');
  assert.equal(createT(en)('no.such.key'), 'no.such.key');
});

const T = Date.UTC(2026, 9, 20, 12, 0);
const order = (o) => ({ status: 'paid', escrowState: 'held', releasePolicy: 'standard', total: 1255000,
  fulfilmentDueAt: T, deliveryEventAt: null, autoReleaseAt: null, ...o });
const say = (o, role, lang = 'en') => renderMoney(createT(lang === 'en' ? en : bn, { strict: true }), describeMoney(order(o), role), lang);

test('NFR-USE-07 the SRS example sentence', () => {
  assert.equal(say({ deliveryEventAt: T - 1, autoReleaseAt: T }, 'buyer'),
    'Your payment is held by TrustBazaar. The seller is paid when you confirm receipt, or automatically on Tue 20 Oct 2026, 6:00 pm unless you open a dispute.');
});

test('money state for every escrow state and both roles', () => {
  assert.match(say({}, 'buyer'), /^Your payment of ৳12,550 is held .* by Tue 20 Oct 2026, 6:00 pm, or you get a full refund\.$/);
  assert.match(say({ status: 'awaiting_payment', escrowState: null, paymentDueAt: T }, 'seller'), /Do not hand over/);
  assert.match(say({ status: 'cancelled', escrowState: null }, 'buyer'), /Nothing was charged/);
  assert.match(say({ releasePolicy: 'game_protection', deliveryEventAt: T - 1, autoReleaseAt: T }, 'buyer'), /protection period ends on Tue 20 Oct/);
  assert.match(say({ escrowState: 'frozen_disputed' }, 'seller'), /only if it is decided in your favour/);
  assert.match(say({ status: 'closed', escrowState: 'released', closedAt: T }, 'seller'), /released to you on Tue 20 Oct/);
  assert.match(say({ status: 'closed', escrowState: 'refunded', closedAt: T }, 'buyer'), /^You were refunded ৳12,550 on/);
  assert.match(say({ status: 'closed', escrowState: 'partially_refunded', refunded: 400000, closedAt: T }, 'seller'),
    /^The buyer was refunded ৳4,000 on .* You were paid the rest\.$/);
  assert.equal(say({ deliveryEventAt: T - 1, autoReleaseAt: T }, 'buyer', 'bn'),
    'আপনার পেমেন্ট TrustBazaar-এর কাছে জমা আছে। আপনি পণ্য পাওয়া নিশ্চিত করলে বিক্রেতা টাকা পাবেন; বিরোধ না খুললে মঙ্গল ২০ অক্টো ২০২৬, ৬:০০ অপরাহ্ণ-এ স্বয়ংক্রিয়ভাবে পাবেন।');
  assert.throws(() => describeMoney(order({ escrowState: 'lost' }), 'buyer'), /unknown escrow state/);
});
