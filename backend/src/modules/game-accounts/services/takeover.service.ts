import { Inject, Injectable, Logger } from '@nestjs/common';
import { createPublicKey } from 'crypto';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import { NOTIFIER, Notifier } from '../../chat/ports';
import { ESCROW_COMMANDS, EscrowCommands, ORDERS_PORT, OrdersPort } from '../../orders/ports';
import type { DisputeCommands } from '../../trust/ports';
import { GAME_DISPUTES } from '../adapters/disputes';
import type { GameEvidence } from '../ports';

// The takeover (docs/design/05_game_accounts.pdf sections 6.6 and 7; FR-GAM-12 to FR-GAM-17; U5-04): TakeoverService.
//  - The checklist (FR-GAM-13): the buyer confirms each of the five steps once (game_accounts.confirm_step, in the
//    append-only confirmations). The fifth completes the takeover: Unit 2's delivery event game_takeover, in the same
//    DC-14 transaction (the order locked first), which starts the protection period CP-24 (FR-GAM-16).
//  - "The credentials do not work" (FR-GAM-14): during the window and until the recovery e-mail step, the handover is
//    disputed and Unit 7's credentials_invalid dispute opened in the same transaction. Unit 7 refuses game-account
//    disputes until U7-10, so until then the report answers feature-off and changes nothing (PROGRESS.md, U5-04).
//  - Re-key (FR-GAM-12): once, during the window and until the recovery e-mail step; the window stops and the seller
//    must seal again for the new key within DV-37 (CP-22 after the request).
//  - A withdrawn credentials_invalid dispute resumes the takeover (GameAccountCommands.disputeWithdrawn, for Unit 7).
// The window-end completion and the overdue re-key are U5-05's jobs. Notices go through Unit 6's Notifier after the commit.

export const STEPS = ['password', 'recovery_email', 'recovery_phone', 'social_logins', 'two_step'] as const;
export type TakeoverStep = (typeof STEPS)[number];

const P256_SPKI = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
const DEFAULT_REPORT = 'The login details I received do not work.';
/** Database refusals, by message: [part, problem, field, reason]. */
const REFUSALS: [string, 'order-state' | 'validation-failed' | 'not-found', string, string][] = [
  ['only the buyer', 'not-found', 'order', 'buyer-only'],
  ['takeover is not in progress', 'order-state', 'handover', 'takeover-not-in-progress'],
  ['the takeover window has ended', 'order-state', 'handover', 'window-ended'],
  ['only during the takeover window', 'order-state', 'handover', 'window-ended'],
  ['recovery e-mail', 'order-state', 'handover', 'recovery-email-confirmed'],
  ['the one re-key has been used', 'order-state', 'handover', 'rekey-used'],
  ['handover is not disputed', 'order-state', 'handover', 'not-disputed'],
];

@Injectable()
export class TakeoverService {
  private readonly log = new Logger('Takeover');

  constructor(
    private readonly db: DataSource,
    @Inject(ORDERS_PORT) private readonly orders: OrdersPort,
    @Inject(ESCROW_COMMANDS) private readonly escrow: EscrowCommands,
    @Inject(GAME_DISPUTES) private readonly disputes: DisputeCommands,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
  ) {}

  /** POST /orders/{id}/game/takeover-steps/{step} (FR-GAM-13, FR-GAM-15). */
  async confirmStep(buyerId: string, orderId: string, step: TakeoverStep, sessionId: string): Promise<{ step: TakeoverStep; takenOverAt: string | null }> {
    const r = await this.db
      .transaction(async (m) => {
        await this.lockOwnOrder(m, buyerId, orderId);
        const [{ done }] = (await m.query(`SELECT game_accounts.confirm_step($1, $2, $3, $4) AS done`, [orderId, buyerId, step, sessionId])) as { done: boolean }[];
        const [h] = (await m.query(`SELECT taken_over_at FROM game_accounts.handovers WHERE order_id = $1`, [orderId])) as { taken_over_at: Date | null }[];
        if (done) await this.escrow.recordDeliveryEvent(orderId, 'game_takeover', h.taken_over_at!, m); // DC-14: the protection period starts
        return { done, at: h.taken_over_at };
      })
      .catch(refusal);
    if (r.done) await this.completed(orderId, buyerId);
    return { step, takenOverAt: r.at?.toISOString() ?? null };
  }

  /** POST /orders/{id}/game/report-invalid (FR-GAM-14): the handover is disputed and the dispute opened together. */
  async reportInvalid(buyerId: string, orderId: string, description?: string): Promise<{ disputeId: string }> {
    const disputeId = await this.db
      .transaction(async (m) => {
        await this.lockOwnOrder(m, buyerId, orderId);
        await m.query(`SELECT game_accounts.report_invalid($1, $2)`, [orderId, buyerId]);
        return this.disputes.open({ orderId, type: 'credentials_invalid', description: description?.trim() || DEFAULT_REPORT, by: 'buyer' }, m);
      })
      .catch(refusal);
    return { disputeId };
  }

  /** POST /orders/{id}/game/rekey (FR-GAM-12): the new browser's public key; the seller seals again within DV-37. */
  async requestRekey(buyerId: string, orderId: string, sessionId: string, publicKey: string): Promise<{ keyVersion: number; redeliveryDueAt: string }> {
    const raw = /^[A-Za-z0-9_-]+$/.test(publicKey) ? Buffer.from(publicKey, 'base64url') : Buffer.alloc(0);
    if (raw.length !== 65 || raw[0] !== 4 || !onCurve(raw)) throw new Problem('validation-failed', { errors: [{ field: 'publicKey', reason: 'not-a-p256-point' }] });
    const redeliver = (await this.params.current()).get<string>('CP-22'); // DV-37: the same time as the first delivery
    const r = await this.db
      .transaction(async (m) => {
        const facts = await this.lockOwnOrder(m, buyerId, orderId);
        const [{ version }] = (await m.query(`SELECT game_accounts.request_rekey($1, $2, $3, $4, $5::interval) AS version`, [orderId, buyerId, raw, sessionId, redeliver])) as { version: number }[];
        const [h] = (await m.query(`SELECT rekey_due_at FROM game_accounts.handovers WHERE order_id = $1`, [orderId])) as { rekey_due_at: Date }[];
        return { version, due: h.rekey_due_at, sellerId: facts.sellerId };
      })
      .catch(refusal);
    const o = await this.orders.getOrderForParty(orderId, buyerId);
    await this.notice(r.sellerId, 'game.rekey_requested', { listing_title: o.listing.title, hours: Math.max(1, Math.round((r.due.getTime() - Date.now()) / 3_600_000)) }, `game:${orderId}:rekey`);
    return { keyVersion: r.version, redeliveryDueAt: r.due.toISOString() };
  }

  /** GameAccountCommands.disputeWithdrawn (Unit 7, FR-DSP-10): the takeover resumes in the caller's transaction. */
  async disputeWithdrawn(orderId: string, tx: EntityManager): Promise<void> {
    await tx.query(`SELECT game_accounts.dispute_withdrawn($1)`, [orderId]).catch(refusal);
  }

  /** GameAccountQueries.credentialsInvalidAllowed (Unit 7, FR-GAM-14): during the window, before the recovery e-mail step. */
  async credentialsInvalidAllowed(orderId: string): Promise<boolean> {
    const [h] = (await this.db.query(
      `SELECT status = 'delivered' AND now() < takeover_due_at AND recovery_email_at IS NULL AS allowed FROM game_accounts.handovers WHERE order_id = $1`,
      [orderId],
    )) as { allowed: boolean }[];
    return h?.allowed === true;
  }

  /** GameAccountQueries.evidence (Unit 7: the case file and the FR-GAM-18 pack). Never a key or the credentials. */
  async evidence(orderId: string): Promise<GameEvidence | null> {
    const [h] = (await this.db.query(`SELECT * FROM game_accounts.handovers WHERE order_id = $1`, [orderId])) as Record<string, never>[];
    if (!h) return null;
    const [details, proofs, confirmations, log] = await Promise.all([
      this.db.query(`SELECT g.name, d.platform, d.player_id, d.contents FROM game_accounts.details d JOIN game_accounts.games g ON g.id = d.game_id WHERE d.listing_id = $1`, [h.listing_id]),
      this.db.query(
        `SELECT code, status, submitted_at, reviewed_at, reviewed_by, live_check, review_reason, screenshot_key, encode(screenshot_sha256, 'hex') AS sha256
           FROM game_accounts.ownership_proofs WHERE listing_id = $1 ORDER BY (status = 'approved') DESC, issued_at DESC LIMIT 1`,
        [h.listing_id],
      ),
      this.db.query(`SELECT step, at, session_id FROM game_accounts.confirmations WHERE order_id = $1 ORDER BY at`, [orderId]),
      this.db.query(`SELECT at, user_id, session_id, key_version, host(source_ip) AS ip FROM game_accounts.access_log WHERE order_id = $1 ORDER BY at, id`, [orderId]),
    ]) as [Record<string, never>[], Record<string, never>[], Record<string, never>[], Record<string, never>[]];
    const d = details[0];
    const p = proofs[0];
    return {
      details: d ? { game: d.name, platform: d.platform, playerId: d.player_id, contents: d.contents } : null,
      proof: p ? {
        code: p.code, status: p.status, submittedAt: p.submitted_at, reviewedAt: p.reviewed_at, reviewedBy: p.reviewed_by, liveCheck: p.live_check, reason: p.review_reason,
        screenshotKey: p.screenshot_key, screenshotSha256: p.sha256,
      } : null,
      handover: {
        status: h.status, disclosureVersion: h.disclosure_version, disclosureAckAt: h.disclosure_ack_at, keyVersion: h.key_version, rekeysUsed: h.rekeys_used,
        credentialsDueAt: h.credentials_due_at, firstDeliveredAt: h.first_delivered_at, deliveredAt: h.delivered_at, takeoverDueAt: h.takeover_due_at,
        takenOverAt: h.taken_over_at, takeoverSource: h.takeover_source, disputedAt: h.disputed_at,
      },
      confirmations: confirmations.map((c) => ({ step: c.step, at: c.at, sessionId: c.session_id })),
      accessLog: log.map((a) => ({ at: a.at, userId: a.user_id, sessionId: a.session_id, keyVersion: a.key_version, sourceIp: a.ip })),
    };
  }

  /** The buyer and the seller are told the account is the buyer's, and how long the protection lasts (CP-24). */
  async completed(orderId: string, partyId: string): Promise<void> {
    const o = await this.orders.getOrderForParty(orderId, partyId);
    const days = Math.round((await this.params.current()).ms('CP-24') / 86_400_000);
    for (const to of [o.buyerId, o.sellerId]) await this.notice(to, 'game.takeover_completed', { listing_title: o.listing.title, days }, `game:${orderId}:taken-over:${to}`);
  }

  /** DC-14: the order is locked first; only its buyer acts. */
  private async lockOwnOrder(m: EntityManager, buyerId: string, orderId: string) {
    const facts = await this.orders.lockForFulfilment(orderId, m);
    if (facts.itemKind !== 'game_account' || (facts.buyerId !== buyerId && facts.sellerId !== buyerId)) throw new Problem('not-found');
    if (facts.buyerId !== buyerId) throw new Problem('forbidden');
    return facts;
  }

  private async notice(userId: string, template: string, params: Record<string, string | number>, key: string): Promise<void> {
    await this.notifier.notify(userId, template, params, key).catch((err: Error) => this.log.warn(`notice ${template} to ${userId}: ${err.message}`));
  }
}

function refusal(err: unknown): never {
  if (err instanceof QueryFailedError) {
    const message = (err.driverError as { message?: string }).message ?? '';
    const hit = REFUSALS.find(([part]) => message.includes(part));
    if (hit) throw new Problem(hit[1], { errors: [{ field: hit[2], reason: hit[3] }] });
  }
  throw err;
}

function onCurve(raw: Buffer): boolean {
  try {
    createPublicKey({ key: Buffer.concat([P256_SPKI, raw]), format: 'der', type: 'spki' });
    return true;
  } catch {
    return false;
  }
}
