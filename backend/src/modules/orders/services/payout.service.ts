import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { EventBus, OutboxEvent } from '../../../kernel/events/event-bus';
import { Problem } from '../../../kernel/http/problems';
import {
  AUDIT_SERVICE, AuditServicePort, CallContext, IDENTITY_CRYPTO, IDENTITY_QUERY, IdentityCryptoPort, IdentityQuery,
} from '../../identity/ports';
import { PAYOUT_PROVIDER, PayoutProvider } from '../adapters/payout-provider';
import { OrdersOutboxEvent, Payout, PayoutAccount, ReconciliationIssue } from '../db/entities';
import { post } from './ledger';

// Payout accounts and payouts (docs/design/02_orders_payments.pdf sections 5.11, 7.4 and 7.5; FR-PAY-17 to
// FR-PAY-19, FR-TNS-05, SEC-PAY-07). U2-10.
//  - A wallet is accepted only on the seller's verified number and cools off for CP-29. A bank account waits
//    for an operator to compare its name with the KYC name (read through getKycLegalName, audited), then
//    cools off. Adding or replacing needs step-up (the route) and alerts the seller (outbox event); the old
//    account becomes replaced, and payouts waiting for an account or a cooling-off move to the new one.
//  - The worker activates cooled-off accounts, makes their waiting payouts pending, and sends pending payouts
//    through the payout adapter with each payout's idempotency key, posting "payout sent". A failure is
//    retried on DV-14's schedule (6 attempts over 12 hours), then raised as payout_failed.
//  - A fraud suspension (identity.account.suspended with fraud) holds the seller's unsent payouts until an
//    operator lifts the hold with a reason.
export const PAYOUT_RETRY_DELAYS_MS = [15 * 60_000, 45 * 60_000, 3_600_000, 4 * 3_600_000, 6 * 3_600_000]; // DV-14: 6 attempts, 12 hours
export const MAX_PAYOUT_ATTEMPTS = PAYOUT_RETRY_DELAYS_MS.length + 1;
const BATCH = 20;
const WALLET = /^\+8801[3-9][0-9]{8}$/;

export type AccountInput =
  | { kind: 'bkash_wallet' | 'nagad_wallet'; walletNumber: string }
  | { kind: 'bank'; bankName: string; branchName?: string; routingNumber: string; accountName: string; accountNumber: string };

export interface PayoutAccountView {
  id: string;
  kind: PayoutAccount['kind'];
  status: PayoutAccount['status'];
  walletMasked: string | null;
  bankName: string | null;
  branchName: string | null;
  accountName: string | null;
  accountLast4: string | null;
  effectiveAt: string | null;
  createdAt: string;
}

export interface PayoutView {
  id: string;
  orderId: string;
  amount: string;
  status: Payout['status'];
  simulated: boolean;
  createdAt: string;
  sentAt: string | null;
}

export type PayoutOutcome = 'sent' | 'retry' | 'failed';

const mask = (e164: string | null) => (e164 ? `***${e164.slice(-3)}` : null);
/** 01XXXXXXXXX or +8801XXXXXXXXX (spaces and dashes ignored) to E.164; null if not a Bangladeshi mobile. */
export function walletE164(input: string): string | null {
  const d = input.replace(/[\s-]/g, '');
  const e = d.startsWith('+') ? d : d.startsWith('880') ? `+${d}` : d.startsWith('0') ? `+88${d}` : d;
  return WALLET.test(e) ? e : null;
}

@Injectable()
export class PayoutService implements OnModuleInit {
  private readonly log = new Logger('PayoutService');

  constructor(
    private readonly db: DataSource,
    private readonly bus: EventBus,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider,
    @Inject(IDENTITY_QUERY) private readonly identity: IdentityQuery,
    @Inject(IDENTITY_CRYPTO) private readonly crypto: IdentityCryptoPort,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.bus.on('identity.account.suspended', 'orders.payout-hold', (e) => this.onSuspended(e));
  }

  // ------------------------------------------------------------------ the seller

  async getAccount(userId: string): Promise<PayoutAccountView | null> {
    const a = await this.db.getRepository(PayoutAccount).findOne({ where: { userId }, order: { createdAt: 'DESC' } });
    return a ? this.view(a) : null;
  }

  /** FR-PAY-17, FR-PAY-18: add or replace the seller's payout account (step-up is checked by the route). */
  async setAccount(userId: string, input: AccountInput, ctx: CallContext = {}): Promise<PayoutAccountView> {
    const now = this.clock.now();
    let fields: Partial<PayoutAccount>;
    if (input.kind === 'bank') {
      fields = {
        kind: 'bank', bankName: input.bankName.trim(), branchName: input.branchName?.trim() || null, routingNumber: input.routingNumber,
        accountName: input.accountName.trim(), accountLast4: input.accountNumber.slice(-4), status: 'pending_review', effectiveAt: null,
      };
    } else {
      const wallet = walletE164(input.walletNumber);
      if (!wallet) throw new Problem('validation-failed', { errors: [{ field: 'walletNumber', reason: 'not-bangladeshi-mobile' }] });
      if (wallet !== (await this.identity.getVerifiedPhone(userId))) {
        throw new Problem('validation-failed', { errors: [{ field: 'walletNumber', reason: 'not-verified-number' }] });
      }
      const cooling = (await this.params.current()).ms('CP-29');
      fields = { kind: input.kind, walletE164: wallet, status: 'cooling_off', effectiveAt: new Date(now.getTime() + cooling) };
    }
    return this.db.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext('payout-account:' || $1))`, [userId]); // one change at a time per seller
      const repo = m.getRepository(PayoutAccount);
      const old = await repo.findOne({ where: [{ userId, status: 'pending_review' }, { userId, status: 'cooling_off' }, { userId, status: 'active' }] });
      if (old) await repo.update({ id: old.id }, { status: 'replaced', replacedAt: now });
      const id = randomUUID(); // known before the insert: the encryption context names the row (the table needs the number with the bank fields)
      const sealed = input.kind === 'bank' ? Buffer.from(await this.crypto.encrypt(input.accountNumber, `payments.payout_accounts.account_number:${id}`)) : null;
      await repo.insert({ id, userId, ...fields, accountNumberEnc: sealed });
      const account = await repo.findOneByOrFail({ id });
      await this.attachWaiting(m, userId, account);
      await this.event(m, 'payments.payout_account.changed', userId, { userId, accountId: id, kind: account.kind, status: account.status, replaced: old !== null });
      await this.audit.record({
        actorType: 'user', actorId: userId, action: 'payments.payout_account.changed', objectType: 'payout_account', objectId: id,
        before: old ? { id: old.id, kind: old.kind } : null, after: { kind: account.kind, status: account.status, last4: account.accountLast4 ?? account.walletE164?.slice(-3) },
        sourceIp: ctx.ip ?? null, correlationId: ctx.correlationId ?? null,
      }, m);
      return this.view(account);
    });
  }

  /** IF-UI-08: the seller's payouts, newest first, 50 a page. */
  async listPayouts(userId: string, before?: string): Promise<{ items: PayoutView[]; nextCursor: string | null }> {
    let at: Date | null = null;
    let id: string | null = null;
    if (before !== undefined) {
      const [t, i] = Buffer.from(before, 'base64url').toString().split('|');
      at = new Date(t);
      id = i ?? null;
      if (Number.isNaN(at.getTime()) || !id || !/^[0-9a-f-]{36}$/.test(id)) throw new Problem('validation-failed', { errors: [{ field: 'cursor', reason: 'format' }] });
    }
    const rows = (await this.db.query(
      `SELECT id, order_id, amount, status, simulated, created_at, sent_at FROM payments.payouts
        WHERE seller_id = $1 AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
        ORDER BY created_at DESC, id DESC LIMIT 51`,
      [userId, at, id],
    )) as { id: string; order_id: string; amount: string; status: Payout['status']; simulated: boolean; created_at: Date; sent_at: Date | null }[];
    const page = rows.slice(0, 50);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({ id: r.id, orderId: r.order_id, amount: String(r.amount), status: r.status, simulated: r.simulated, createdAt: r.created_at.toISOString(), sentAt: r.sent_at?.toISOString() ?? null })),
      nextCursor: rows.length > 50 ? Buffer.from(`${last.created_at.toISOString()}|${last.id}`).toString('base64url') : null,
    };
  }

  // ------------------------------------------------------------------ operators (section 7.5)

  /** Bank accounts awaiting the name check, each with the KYC legal name to compare (read is audited by Unit 1). */
  async pendingBankAccounts(staffId: string, ctx: CallContext = {}) {
    const rows = await this.db.getRepository(PayoutAccount).find({ where: { status: 'pending_review' }, order: { createdAt: 'ASC' }, take: 100 });
    const out: (PayoutAccountView & { userId: string; routingNumber: string | null; kycLegalName: string })[] = [];
    for (const a of rows) {
      const kycLegalName = await this.identity.getKycLegalName(a.userId, 'bank_payout_check', { ip: ctx.ip, correlationId: ctx.correlationId ?? staffId });
      out.push({ ...this.view(a), userId: a.userId, routingNumber: a.routingNumber, kycLegalName });
    }
    return out;
  }

  /** FR-PAY-17: approve (then cooling-off CP-29) or reject a bank account, with a reason and an audit entry. */
  async decideBankAccount(staffId: string, accountId: string, decision: 'approve' | 'reject', reason: string, ctx: CallContext = {}): Promise<PayoutAccountView> {
    const now = this.clock.now();
    const cooling = (await this.params.current()).ms('CP-29');
    return this.db.transaction(async (m) => {
      const repo = m.getRepository(PayoutAccount);
      const a = await repo.findOne({ where: { id: accountId }, lock: { mode: 'pessimistic_write' } });
      if (!a) throw new Problem('not-found');
      if (a.status !== 'pending_review') throw new Problem('payout-state');
      const patch = decision === 'approve'
        ? { status: 'cooling_off' as const, effectiveAt: new Date(now.getTime() + cooling), reviewedBy: staffId, reviewedAt: now }
        : { status: 'rejected' as const, reviewedBy: staffId, reviewedAt: now };
      await repo.update({ id: a.id }, patch);
      const after = await repo.findOneByOrFail({ id: a.id });
      if (decision === 'approve') await this.attachWaiting(m, a.userId, after);
      await this.event(m, 'payments.payout_account.reviewed', a.userId, { userId: a.userId, accountId: a.id, decision });
      await this.audit.record({
        actorType: 'staff', actorId: staffId, action: `payments.payout_account.${decision === 'approve' ? 'approved' : 'rejected'}`, objectType: 'payout_account',
        objectId: a.id, before: { status: a.status }, after: { status: after.status }, reason, sourceIp: ctx.ip ?? null, correlationId: ctx.correlationId ?? null,
      }, m);
      return this.view(after);
    });
  }

  /** FR-TNS-05: lift a hold; the payout continues from the seller's current account. */
  async releaseHold(staffId: string, payoutId: string, reason: string, ctx: CallContext = {}): Promise<PayoutView> {
    return this.db.transaction(async (m) => {
      const p = await m.getRepository(Payout).findOne({ where: { id: payoutId }, lock: { mode: 'pessimistic_write' } });
      if (!p) throw new Problem('not-found');
      if (p.status !== 'held') throw new Problem('payout-state');
      const account = await this.usable(m, p.sellerId);
      const now = this.clock.now();
      const status = !account ? 'waiting_account' : account.effectiveAt! > now ? 'waiting_cooling_off' : 'pending';
      await m.getRepository(Payout).update({ id: p.id }, { status, holdReason: null, payoutAccountId: account?.id ?? null, nextAttemptAt: now });
      await this.audit.record({
        actorType: 'staff', actorId: staffId, action: 'payments.payout.hold_released', objectType: 'payout', objectId: p.id,
        before: { status: 'held', holdReason: p.holdReason }, after: { status }, reason, sourceIp: ctx.ip ?? null, correlationId: ctx.correlationId ?? null,
      }, m);
      return this.payoutView({ ...p, status, sentAt: null });
    });
  }

  // ------------------------------------------------------------------ events and the worker

  /** FR-TNS-05: a fraud suspension holds every unsent payout of the seller (idempotent). */
  async onSuspended(e: OutboxEvent): Promise<void> {
    const { userId, fraud } = e.payload as { userId?: string; fraud?: boolean };
    if (!userId || fraud !== true) return;
    await this.db.transaction(async (m) => {
      const held = (await m.query(
        `UPDATE payments.payouts SET status = 'held', hold_reason = 'fraud suspension'
          WHERE seller_id = $1 AND status IN ('waiting_account', 'waiting_cooling_off', 'pending', 'failed') RETURNING id`,
        [userId],
      )) as unknown;
      const ids = (Array.isArray(held) && Array.isArray(held[0]) ? held[0] : held) as { id: string }[];
      if (ids.length) {
        await this.audit.record({ actorType: 'system', action: 'payments.payout.held', objectType: 'user', objectId: userId, after: { payouts: ids.map((r) => r.id) }, reason: 'fraud suspension' }, m);
      }
    });
  }

  /** The payout worker (every minute, U2-07): activate cooled-off accounts, then send what is due. */
  async processDue(): Promise<PayoutOutcome[]> {
    const now = this.clock.now();
    await this.db.transaction(async (m) => {
      await m.query(`UPDATE payments.payout_accounts SET status = 'active' WHERE status = 'cooling_off' AND effective_at <= $1`, [now]);
      await m.query(
        `UPDATE payments.payouts p SET status = 'pending', next_attempt_at = $1 FROM payments.payout_accounts a
          WHERE p.status = 'waiting_cooling_off' AND a.id = p.payout_account_id AND a.status = 'active' AND a.effective_at <= $1`,
        [now],
      );
    });
    const outcomes: PayoutOutcome[] = [];
    for (let i = 0; i < BATCH; i++) {
      const outcome = await this.db.transaction(async (m) => {
        const [due] = (await m.query(
          `SELECT id FROM payments.payouts WHERE status IN ('pending', 'failed') AND attempts_made < $2 AND next_attempt_at <= $1
            ORDER BY next_attempt_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [now, MAX_PAYOUT_ATTEMPTS],
        )) as { id: string }[];
        return due ? this.send(m, due.id) : null;
      });
      if (!outcome) break;
      outcomes.push(outcome);
    }
    return outcomes;
  }

  private async send(m: EntityManager, payoutId: string): Promise<PayoutOutcome> {
    const p = await m.getRepository(Payout).findOneByOrFail({ id: payoutId });
    const a = await m.getRepository(PayoutAccount).findOneByOrFail({ id: p.payoutAccountId! });
    const now = this.clock.now();
    const made = p.attemptsMade + 1;
    let r: { status: 'sent' | 'failed'; ref?: string };
    try {
      r = await this.provider.send({
        payoutId: p.id, amount: BigInt(p.amount), idempotencyKey: p.idempotencyKey,
        destination: { kind: a.kind, walletE164: a.walletE164, bankName: a.bankName, routingNumber: a.routingNumber, accountLast4: a.accountLast4 },
      });
    } catch (err) {
      this.log.warn(`payout ${p.id} attempt ${made}: ${(err as Error).message}`);
      r = { status: 'failed' };
    }
    if (r.status === 'sent') {
      await m.getRepository(Payout).update({ id: p.id }, { status: 'sent', sentAt: now, providerRef: r.ref ?? null, attemptsMade: made });
      await post(m, 'payout_sent', p.orderId, p.id, `payout to the seller${p.simulated ? ' (simulated)' : ''}`, [['seller_payable', p.sellerId, BigInt(p.amount)], ['payout_clearing', null, -BigInt(p.amount)]]);
      await this.event(m, 'payments.payout.sent', p.orderId, { payoutId: p.id, orderId: p.orderId, sellerId: p.sellerId, amount: p.amount, simulated: p.simulated });
      return 'sent';
    }
    if (made >= MAX_PAYOUT_ATTEMPTS) {
      await m.getRepository(Payout).update({ id: p.id }, { status: 'failed', attemptsMade: made });
      await m.getRepository(ReconciliationIssue).insert({ kind: 'payout_failed', orderId: p.orderId, payoutId: p.id, detail: { payoutId: p.id, amount: p.amount, attempts: made } });
      await this.event(m, 'payments.payout.failed', p.orderId, { payoutId: p.id, orderId: p.orderId, sellerId: p.sellerId, amount: p.amount });
      return 'failed';
    }
    await m.getRepository(Payout).update({ id: p.id }, { status: 'failed', attemptsMade: made, nextAttemptAt: new Date(now.getTime() + PAYOUT_RETRY_DELAYS_MS[made - 1]) });
    return 'retry';
  }

  // ------------------------------------------------------------------ helpers

  /** Payouts waiting for an account or a cooling-off move to the seller's new usable account. */
  private async attachWaiting(m: EntityManager, userId: string, account: PayoutAccount): Promise<void> {
    if (account.status === 'pending_review' || account.status === 'rejected') {
      await m.query(`UPDATE payments.payouts SET status = 'waiting_account', payout_account_id = NULL WHERE seller_id = $1 AND status = 'waiting_cooling_off'`, [userId]);
      return;
    }
    await m.query(
      `UPDATE payments.payouts SET status = 'waiting_cooling_off', payout_account_id = $2 WHERE seller_id = $1 AND status IN ('waiting_account', 'waiting_cooling_off')`,
      [userId, account.id],
    );
  }

  private usable(m: EntityManager, userId: string): Promise<PayoutAccount | null> {
    return m.getRepository(PayoutAccount).findOne({ where: [{ userId, status: 'cooling_off' }, { userId, status: 'active' }] });
  }

  private event(m: EntityManager, eventType: string, aggregateId: string, payload: Record<string, unknown>) {
    return m.getRepository(OrdersOutboxEvent).insert({ eventType, aggregateId, payload });
  }

  private view(a: PayoutAccount): PayoutAccountView {
    return {
      id: a.id, kind: a.kind, status: a.status, walletMasked: mask(a.walletE164), bankName: a.bankName, branchName: a.branchName, accountName: a.accountName,
      accountLast4: a.accountLast4, effectiveAt: a.effectiveAt?.toISOString() ?? null, createdAt: a.createdAt.toISOString(),
    };
  }

  private payoutView(p: Pick<Payout, 'id' | 'orderId' | 'amount' | 'status' | 'simulated' | 'createdAt' | 'sentAt'>): PayoutView {
    return { id: p.id, orderId: p.orderId, amount: p.amount, status: p.status, simulated: p.simulated, createdAt: p.createdAt.toISOString(), sentAt: p.sentAt?.toISOString() ?? null };
  }
}
