import { randomInt, randomUUID } from 'crypto';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;
import { OutboxDispatcher } from '../../src/kernel/events/outbox-dispatcher';
import { IDENTITY_COMMANDS, IDENTITY_CRYPTO, IdentityCommands, IdentityCryptoPort } from '../../src/modules/identity/ports';
import { KycReviewService } from '../../src/modules/identity/services/kyc-review.service';
import { KycService } from '../../src/modules/identity/services/kyc.service';
import { PayoutService } from '../../src/modules/orders/services/payout.service';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U2-10: payout accounts, the payout worker, fraud holds and the staff endpoints (docs/design/02_orders_payments.pdf
// sections 4, 5.11, 7.4 and 7.5), over HTTP against PostgreSQL. Released orders are written as tb_app with the
// payout row U2-04's settle() leaves.
describe('payout accounts and payouts', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let payouts: PayoutService;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    payouts = t.app.get(PayoutService);
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  const ip = () => `203.0.113.${randomInt(1, 255)}, 10.8.${randomInt(0, 255)}.${randomInt(1, 255)}`;
  const one = async <T = Record<string, unknown>>(sql: string, p: unknown[]) => (await fx.query<T>(sql, p))[0];

  async function seller(o: { kyc?: string } = {}) {
    const userId = await fx.user({ kyc: o.kyc ?? 'verified', emailVerified: true });
    const sid = await fx.session({ userId });
    const { phone_e164: phone } = await one<{ phone_e164: string }>(`SELECT phone_e164 FROM identity.users WHERE id = $1`, [userId]);
    const call = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
      fetch(t.url(path), {
        method,
        headers: { ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const stepped = async (body: unknown) => call('POST', '/me/payout-account', body, { 'x-step-up': await fx.stepUpGrant(sid, 'payout.change') });
    return { userId, sid, phone, call, stepped };
  }
  async function operator() {
    const staffId = await fx.staff('operator');
    const sid = await fx.session({ staffId });
    return (method: string, path: string, body?: unknown) =>
      fetch(t.url(path), {
        method,
        headers: { ...fx.headers(sid, staffId, 'staff'), 'x-forwarded-for': ip(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
  }
  /** A closed order with the payout row a release leaves, in the given status. */
  async function payout(sellerId: string, status: string, accountId: string | null = null, amount = 950_000) {
    const [{ id: orderId }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at)
       VALUES ('fixed_price', $1, 'physical', $2, $3, 1, 1000000, 1000000, 'self_pickup', 0, 1000000, '{"title":"Item"}', 500, 1000, 1, now(), 'paid', now(), 'meetup_handover', now() + interval '7 days') RETURNING id`,
      [randomUUID(), await fx.user(), sellerId],
    );
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO payments.payouts (order_id, seller_id, payout_account_id, amount, status, hold_reason, simulated) VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id`,
      [orderId, sellerId, accountId, amount, status, status === 'held' ? 'seller account suspended' : null],
    );
    return { id, orderId };
  }
  const statusOf = async (id: string) => (await one<{ status: string }>(`SELECT status FROM payments.payouts WHERE id = $1`, [id])).status;
  /** Ends the cooling-off of the seller's account now, as if CP-29 had passed. */
  const cooled = (userId: string) => fx.query(`UPDATE payments.payout_accounts SET effective_at = now() - interval '1 second' WHERE user_id = $1 AND status = 'cooling_off'`, [userId]);
  /** Delivers every waiting event; earlier test files and runs may leave more than one batch (100). */
  const deliver = async () => {
    for (let i = 0; i < 100; i++) {
      const r = await t.app.get(OutboxDispatcher).drain();
      if (r.dispatched + r.failed + r.givenUp === 0) break;
    }
  };
  const drain = async () => { for (let i = 0; i < 50 && (await payouts.processDue()).length > 0; i++); }; // other specs leave due payouts too

  it('FR-PAY-17 a wallet only on the verified number, after step-up; it cools off and the seller is alerted', async () => {
    const s = await seller();
    expect(await (await s.call('GET', '/me/payout-account')).json()).toEqual({ account: null });
    const local = `0${s.phone.slice(4)}`;
    expect((await s.call('POST', '/me/payout-account', { kind: 'bkash_wallet', walletNumber: local })).status).toBe(403); // no step-up
    const other = await s.stepped({ kind: 'bkash_wallet', walletNumber: '01712345678' === local ? '01812345678' : '01712345678' });
    expect([other.status, (await other.json()).errors]).toEqual([400, [{ field: 'walletNumber', reason: 'not-verified-number' }]]);
    const r = await s.stepped({ kind: 'bkash_wallet', walletNumber: local });
    expect(r.status).toBe(201);
    const { account } = await r.json();
    expect(account).toMatchObject({ kind: 'bkash_wallet', status: 'cooling_off', walletMasked: `***${s.phone.slice(-3)}` });
    expect(new Date(account.effectiveAt).getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000); // CP-29, 24 hours
    const [ev] = await fx.query(`SELECT payload FROM orders.outbox WHERE event_type = 'payments.payout_account.changed' AND aggregate_id = $1`, [s.userId]);
    expect(ev).toEqual({ payload: expect.objectContaining({ userId: s.userId, kind: 'bkash_wallet', replaced: false }) });
    expect((await (await s.call('GET', '/me/payout-account')).json()).account.id).toBe(account.id);
  });

  it('FR-PAY-18 FR-PAY-19 a change replaces the account; waiting payouts move to it and are sent once it has cooled off', async () => {
    const s = await seller();
    const waiting = await payout(s.userId, 'waiting_account');
    const first = (await (await s.stepped({ kind: 'nagad_wallet', walletNumber: s.phone })).json()).account;
    expect(await one(`SELECT status, payout_account_id FROM payments.payouts WHERE id = $1`, [waiting.id])).toEqual({ status: 'waiting_cooling_off', payout_account_id: first.id });
    const second = (await (await s.stepped({ kind: 'bkash_wallet', walletNumber: s.phone })).json()).account;
    expect(await one(`SELECT status FROM payments.payout_accounts WHERE id = $1`, [first.id])).toEqual({ status: 'replaced' });
    expect(await one(`SELECT payout_account_id FROM payments.payouts WHERE id = $1`, [waiting.id])).toEqual({ payout_account_id: second.id });
    await drain();
    expect(await statusOf(waiting.id)).toBe('waiting_cooling_off'); // not before CP-29
    await cooled(s.userId);
    await drain();
    const p = await one<{ status: string; provider_ref: string; attempts_made: number }>(`SELECT status, provider_ref, attempts_made FROM payments.payouts WHERE id = $1`, [waiting.id]);
    expect(p).toEqual({ status: 'sent', provider_ref: expect.stringMatching(/^simpayout_/), attempts_made: 1 });
    expect(await one(`SELECT status FROM payments.payout_accounts WHERE id = $1`, [second.id])).toEqual({ status: 'active' });
    const lines = await fx.query(`SELECT l.account_code, l.amount FROM payments.journal_lines l JOIN payments.journal_entries e ON e.id = l.entry_id WHERE e.kind = 'payout_sent' AND e.source_id = $1 ORDER BY 1`, [waiting.id]);
    expect(lines).toEqual([{ account_code: 'payout_clearing', amount: '-950000' }, { account_code: 'seller_payable', amount: '950000' }]);
    const list = await (await s.call('GET', '/me/payouts')).json();
    expect(list).toEqual({ items: [expect.objectContaining({ id: waiting.id, status: 'sent', simulated: true, amount: '950000' })], nextCursor: null });
  });

  it('FR-PAY-17 a bank account waits for the operator\'s name check against the KYC name, then cools off', async () => {
    const a = await fx.account({ kyc: 'unsubmitted' });
    const op = await fx.staffAccount('operator');
    const ctx = { ip: null, userAgent: null, correlationId: null };
    const ch = await t.app.get(KycService).livenessChallenge(a.userId);
    const img = await sharp({ create: { width: 300, height: 200, channels: 3, background: 'white' } }).jpeg().toBuffer();
    const { submissionId } = await t.app.get(KycService).submit(
      a.userId, { docType: 'nid', docNumber: String(randomInt(1e9, 1e10)), fullName: 'Rahim Uddin', dateOfBirth: '1990-01-01', challengeId: ch.challengeId },
      { doc_front: img, doc_back: img, selfie_neutral: img, selfie_action: img }, ctx,
    );
    await t.app.get(KycReviewService).claim(op.staffId, submissionId, ctx);
    await t.app.get(KycReviewService).decide(op.staffId, submissionId, { decision: 'approve' }, ctx);
    const sid = await fx.session({ userId: a.userId });
    const bank = { kind: 'bank', bankName: 'Dutch-Bangla Bank', branchName: 'Motijheel', routingNumber: '090271234', accountName: 'Rahim Uddin', accountNumber: '1234567890123' };
    const r = await fetch(t.url('/me/payout-account'), {
      method: 'POST', body: JSON.stringify(bank),
      headers: { ...fx.headers(sid, a.userId, 'user'), 'content-type': 'application/json', 'x-forwarded-for': ip(), 'x-step-up': await fx.stepUpGrant(sid, 'payout.change') },
    });
    const { account } = await r.json();
    expect(account).toMatchObject({ kind: 'bank', status: 'pending_review', accountLast4: '0123', effectiveAt: null });
    const row = await one<{ account_number_enc: Buffer }>(`SELECT account_number_enc FROM payments.payout_accounts WHERE id = $1`, [account.id]);
    expect(row.account_number_enc.toString('latin1')).not.toContain('1234567890123'); // SEC: encrypted with Unit 1's field key
    const crypto = t.app.get<IdentityCryptoPort>(IDENTITY_CRYPTO);
    expect(await crypto.decrypt(row.account_number_enc, `payments.payout_accounts.account_number:${account.id}`)).toBe('1234567890123');
    const staff = await operator();
    const pending = (await (await staff('GET', '/staff/payout-accounts/pending')).json()).items.find((x: { id: string }) => x.id === account.id);
    expect(pending).toMatchObject({ accountName: 'Rahim Uddin', kycLegalName: 'Rahim Uddin', routingNumber: '090271234' });
    expect(pending).not.toHaveProperty('accountNumber');
    expect((await staff('POST', `/staff/payout-accounts/${account.id}/decision`, { decision: 'approve', reason: '  ' })).status).toBe(400);
    const d = await staff('POST', `/staff/payout-accounts/${account.id}/decision`, { decision: 'approve', reason: 'Name matches the NID' });
    expect((await d.json()).account).toMatchObject({ status: 'cooling_off' });
    expect((await staff('POST', `/staff/payout-accounts/${account.id}/decision`, { decision: 'reject', reason: 'again' })).status).toBe(409);
    expect(await fx.query(`SELECT reason FROM audit.events WHERE action = 'payments.payout_account.approved' AND object_id = $1`, [account.id])).toEqual([{ reason: 'Name matches the NID' }]);
  });

  it('FR-TNS-05 a fraud suspension holds unsent payouts; an operator lifts the hold with a reason', async () => {
    const s = await seller();
    const { account } = await (await s.stepped({ kind: 'bkash_wallet', walletNumber: s.phone })).json();
    await cooled(s.userId);
    const pending = await payout(s.userId, 'pending', account.id);
    const waiting = await payout(s.userId, 'waiting_cooling_off', account.id);
    const op = await fx.staff('operator');
    await t.app.get<IdentityCommands>(IDENTITY_COMMANDS).suspendAccount(s.userId, 'Reported for fraud', op, { fraud: true });
    await deliver();
    expect([await statusOf(pending.id), await statusOf(waiting.id)]).toEqual(['held', 'held']);
    await drain();
    expect(await statusOf(pending.id)).toBe('held'); // the worker does not send held payouts
    const staff = await operator();
    expect((await staff('POST', `/staff/payouts/${pending.id}/release-hold`, {})).status).toBe(400);
    const r = await staff('POST', `/staff/payouts/${pending.id}/release-hold`, { reason: 'Investigation cleared the seller' });
    expect((await r.json()).payout).toMatchObject({ status: 'pending' });
    expect((await staff('POST', `/staff/payouts/${pending.id}/release-hold`, { reason: 'again' })).status).toBe(409);
    const plain = await seller();
    const kept = await payout(plain.userId, 'waiting_account');
    await t.app.get<IdentityCommands>(IDENTITY_COMMANDS).suspendAccount(plain.userId, 'Rude to buyers', op);
    await deliver();
    expect(await statusOf(kept.id)).toBe('waiting_account'); // only a fraud suspension holds existing payouts
  });

  it('SEC-SDL-09 users cannot reach the staff endpoints, nor an unverified user the payout account', async () => {
    const s = await seller();
    expect((await s.call('GET', '/staff/payout-accounts/pending')).status).toBe(401);
    expect((await s.call('POST', `/staff/payouts/${randomUUID()}/release-hold`, { reason: 'x' })).status).toBe(401);
    const unverified = await seller({ kyc: 'unsubmitted' });
    expect((await unverified.call('GET', '/me/payout-account')).status).toBe(403);
    expect((await fetch(t.url('/me/payouts'))).status).toBe(401);
    const staff = await operator();
    expect((await staff('POST', `/staff/payouts/${randomUUID()}/release-hold`, { reason: 'x' })).status).toBe(404);
  });
});
