import { Inject, Injectable, Logger } from '@nestjs/common';
import { createPublicKey } from 'crypto';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import type { OutboxEvent } from '../../../kernel/events/event-bus';
import { Problem } from '../../../kernel/http/problems';
import { NOTIFIER, Notifier } from '../../chat/ports';
import { ESCROW_COMMANDS, EscrowCommands, ORDERS_PORT, OrdersPort } from '../../orders/ports';
import { DISCLOSURE_VERSION, GameAccountPort } from '../ports';

// The sealed handover (docs/design/05_game_accounts.pdf section 6; FR-GAM-05, FR-GAM-07, FR-GAM-09 to FR-GAM-11,
// FR-GAM-19, I-29, I-32; U5-03): HandoverService.
//  - The buyer acknowledges the publisher-risk disclosure, by version, on an unpaid game-account order: the handover
//    starts as preparing, without a key.
//  - The buyer's browser registers its public key (an uncompressed P-256 point, 65 bytes): version 1, fixed until the
//    order is paid (game_accounts.register_key). The server checks the point lies on the curve.
//  - Unit 2 starts a payment only when assertCheckoutReady passes (CP-36 on, disclosure and key).
//  - When the order is paid, the seller is asked for the credentials by the order's CP-22 deadline (mark_paid), and the
//    listing's player-ID claim names the order. An order cancelled unpaid cancels its handover.
//  - The seller fetches the buyer's current public key and delivers enc and the ciphertext sealed for it (HPKE, by the
//    seller's browser; sealed.js), by the CP-22 deadline. DC-14: the order is locked first (OrdersPort), then the
//    handover (game_accounts.deliver), and the first delivery is Unit 2's fulfilment step; the takeover window is CP-23.
//  - The buyer retrieves enc and the ciphertext; every retrieval is logged (game_accounts.fetch_sealed).
//  - When the order's escrow is terminal, the ciphertext is deleted and the handover cancelled (before the takeover) or
//    closed (game_accounts.finish), and the listing's player-ID claim is released.
//  - Notices (Unit 6's Notifier, after the commit): the seller when the credentials are requested, the buyer when they
//    are delivered.
// No response ever carries a private key, plaintext or a fingerprint (section 6.3); the server cannot open what it keeps.

/** SubjectPublicKeyInfo header of an uncompressed P-256 point (RFC 5480), to let OpenSSL check the point. */
const P256_SPKI = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
const B64URL = /^[A-Za-z0-9_-]+$/;
const b64 = (v: string) => (B64URL.test(v) ? Buffer.from(v, 'base64url') : Buffer.alloc(0));
/** Database refusals of deliver and fetch_sealed, by message: [part, problem, field, reason]. */
const DELIVERY_REFUSALS: [string, 'order-state' | 'validation-failed' | 'not-found' | 'forbidden', string, string][] = [
  ['credentials are not expected now', 'order-state', 'handover', 'credentials-not-expected'],
  ['delivery deadline has passed', 'order-state', 'handover', 'deadline-passed'],
  ['re-delivery deadline has passed', 'order-state', 'handover', 'deadline-passed'],
  ["but the buyer's current key is version", 'validation-failed', 'keyVersion', 'stale-key-version'],
  ['only the seller delivers', 'forbidden', 'order', 'seller-only'],
  ['only the buyer of this order', 'not-found', 'order', 'buyer-only'],
  ['no credentials are available', 'not-found', 'credentials', 'none'],
];
const str = (v: unknown) => (typeof v === 'string' ? v : '');

interface HandoverRow {
  status: string;
  disclosure_version: number;
  disclosure_ack_at: Date;
  key_version: number;
  rekeys_used: number;
  credentials_due_at: Date | null;
  first_delivered_at: Date | null;
  delivered_at: Date | null;
  takeover_due_at: Date | null;
  rekey_due_at: Date | null;
  taken_over_at: Date | null;
  cancelled_at: Date | null;
  closed_at: Date | null;
  takeover_source: string | null;
  pw_changed_at: Date | null;
  recovery_email_at: Date | null;
  recovery_phone_at: Date | null;
  social_logins_at: Date | null;
  two_step_at: Date | null;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

@Injectable()
export class HandoverService implements GameAccountPort {
  private readonly log = new Logger('Handover');

  constructor(
    private readonly db: DataSource,
    @Inject(ORDERS_PORT) private readonly orders: OrdersPort,
    @Inject(ESCROW_COMMANDS) private readonly escrow: EscrowCommands,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** POST /orders/{id}/game/acknowledge (FR-GAM-05). Repeating it is harmless. */
  async acknowledge(buyerId: string, orderId: string, version: number) {
    await this.featureOn();
    const o = await this.gameOrder(buyerId, orderId, 'buyer');
    if (o.status !== 'awaiting_payment') throw new Problem('order-state');
    if (version !== DISCLOSURE_VERSION) throw new Problem('validation-failed', { errors: [{ field: 'version', reason: 'not-current' }] });
    await this.db.query(
      `INSERT INTO game_accounts.handovers (order_id, listing_id, buyer_id, seller_id, disclosure_version) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (order_id) DO NOTHING`,
      [orderId, o.listing.id, o.buyerId, o.sellerId, version],
    );
    return this.view(buyerId, orderId);
  }

  /** POST /orders/{id}/game/key (FR-GAM-07): the browser's public key, base64url of the raw 65-byte point. */
  async registerKey(buyerId: string, orderId: string, sessionId: string, publicKey: string) {
    await this.featureOn();
    await this.gameOrder(buyerId, orderId, 'buyer');
    const raw = B64URL.test(publicKey) ? Buffer.from(publicKey, 'base64url') : Buffer.alloc(0);
    if (raw.length !== 65 || raw[0] !== 4 || !onCurve(raw))
      throw new Problem('validation-failed', { errors: [{ field: 'publicKey', reason: 'not-a-p256-point' }] });
    try {
      const [{ version }] = (await this.db.query(`SELECT game_accounts.register_key($1, $2, $3, $4) AS version`, [orderId, buyerId, raw, sessionId])) as {
        version: number;
      }[];
      return { keyVersion: version };
    } catch (err) {
      const message = err instanceof QueryFailedError ? ((err.driverError as { message?: string }).message ?? '') : '';
      if (message.includes('acknowledge the disclosure first'))
        throw new Problem('validation-failed', { errors: [{ field: 'disclosure', reason: 'not-acknowledged' }] });
      if (message.includes('the key is fixed')) throw new Problem('validation-failed', { errors: [{ field: 'publicKey', reason: 'key-fixed' }] });
      throw err;
    }
  }

  /** GET /orders/{id}/game: the handover as either party sees it; never the key, a fingerprint or a ciphertext. */
  async view(userId: string, orderId: string) {
    const o = await this.gameOrder(userId, orderId);
    const [h] = (await this.db.query(`SELECT * FROM game_accounts.handovers WHERE order_id = $1`, [orderId])) as HandoverRow[];
    return {
      orderId,
      role: o.role,
      disclosure: { currentVersion: DISCLOSURE_VERSION, acknowledgedVersion: h?.disclosure_version ?? null, acknowledgedAt: iso(h?.disclosure_ack_at ?? null) },
      status: h?.status ?? null,
      keyVersion: h?.key_version ?? 0,
      rekeysUsed: h?.rekeys_used ?? 0,
      credentialsDueAt: iso(h?.credentials_due_at ?? null),
      firstDeliveredAt: iso(h?.first_delivered_at ?? null),
      deliveredAt: iso(h?.delivered_at ?? null),
      takeoverDueAt: iso(h?.takeover_due_at ?? null),
      rekeyDueAt: iso(h?.rekey_due_at ?? null),
      takenOverAt: iso(h?.taken_over_at ?? null),
      takeoverSource: h?.takeover_source ?? null,
      // FR-GAM-13: the confirmed checklist steps; FR-GAM-16: the protection period's end, Unit 2's release date
      steps: {
        password: iso(h?.pw_changed_at ?? null),
        recovery_email: iso(h?.recovery_email_at ?? null),
        recovery_phone: iso(h?.recovery_phone_at ?? null),
        social_logins: iso(h?.social_logins_at ?? null),
        two_step: iso(h?.two_step_at ?? null),
      },
      protectionEndsAt: h?.taken_over_at ? (o.escrow?.autoReleaseAt ?? null) : null,
    };
  }

  /** GameAccountPort (I-29): Unit 2 calls it before a game-account order's payment starts. */
  async assertCheckoutReady(orderId: string): Promise<void> {
    await this.featureOn();
    const [{ ready }] = (await this.db.query(`SELECT game_accounts.checkout_ready($1) AS ready`, [orderId])) as { ready: boolean }[];
    if (!ready) throw new Problem('order-state', { errors: [{ field: 'game', reason: 'checkout-not-ready' }] });
  }

  /** orders.order.paid (game account): the seller is asked for the credentials by the order's CP-22 deadline. */
  async onPaid(e: OutboxEvent): Promise<boolean> {
    if (e.payload.itemKind !== 'game_account') return false;
    const orderId = str(e.payload.orderId) || e.aggregateId;
    const due = str(e.payload.fulfilmentDueAt);
    if (!due) throw new Error(`orders.order.paid ${e.id}: no fulfilmentDueAt for game-account order ${orderId}`); // I-29
    const asked = await this.db.transaction(async (m) => {
      const [h] = (await m.query(`SELECT status, listing_id FROM game_accounts.handovers WHERE order_id = $1 FOR UPDATE`, [orderId])) as {
        status: string;
        listing_id: string;
      }[];
      if (!h) throw new Error(`orders.order.paid ${e.id}: game-account order ${orderId} has no handover`); // payment needs one (assertCheckoutReady)
      if (h.status !== 'preparing') return false; // delivered twice
      await m.query(`SELECT game_accounts.mark_paid($1, $2)`, [orderId, due]);
      await m.query(`UPDATE game_accounts.claims SET order_id = $2 WHERE listing_id = $1 AND released_at IS NULL AND order_id IS NULL`, [
        h.listing_id,
        orderId,
      ]);
      return true;
    });
    // I-32: the seller is asked, with the hours left (the dedupe key makes a redelivered event harmless)
    await this.notice(
      str(e.payload.sellerId),
      'game.credentials_requested',
      { listing_title: str(e.payload.listingTitle) || '—', hours: this.hoursUntil(new Date(due)) },
      `game:${orderId}:requested`,
    );
    return asked;
  }

  // ------------------------------------------------------------------ the sealed delivery and retrieval

  /** GET /orders/{id}/game/buyer-key: the seller's browser seals for this key (and shows its fingerprint itself). */
  async buyerKey(sellerId: string, orderId: string): Promise<{ keyVersion: number; publicKey: string }> {
    const o = await this.gameOrder(sellerId, orderId);
    if (o.role !== 'seller') throw new Problem('forbidden');
    const [k] = (await this.db.query(
      `SELECT k.version, k.public_key FROM game_accounts.handovers h JOIN game_accounts.buyer_keys k ON k.order_id = h.order_id AND k.version = h.key_version
        WHERE h.order_id = $1 AND h.status IN ('awaiting_credentials', 'rekey_requested')`,
      [orderId],
    )) as { version: number; public_key: Buffer }[];
    if (!k) throw new Problem('order-state', { errors: [{ field: 'handover', reason: 'credentials-not-expected' }] });
    return { keyVersion: k.version, publicKey: k.public_key.toString('base64url') };
  }

  /** POST /orders/{id}/game/sealed (FR-GAM-09, FR-GAM-10): the seller's sealed delivery for the buyer's current key. */
  async deliver(
    sellerId: string,
    orderId: string,
    d: { keyVersion: number; enc: string; ciphertext: string },
  ): Promise<{ deliveredAt: string; takeoverDueAt: string }> {
    // no CP-36 check: a paid order continues while the switch is off (FR-GAM-01)
    const o = await this.gameOrder(sellerId, orderId);
    if (o.role !== 'seller') throw new Problem('forbidden');
    const enc = b64(d.enc);
    const ciphertext = b64(d.ciphertext);
    if (enc.length !== 65 || enc[0] !== 4) throw new Problem('validation-failed', { errors: [{ field: 'enc', reason: 'not-a-p256-point' }] });
    if (ciphertext.length < 528 || ciphertext.length > 4112 || (ciphertext.length - 16) % 512 !== 0) {
      throw new Problem('validation-failed', { errors: [{ field: 'ciphertext', reason: 'not-padded' }] }); // DV-34
    }
    const window = (await this.params.current()).get<string>('CP-23');
    const r = await this.db
      .transaction(async (m) => {
        const facts = await this.orders.lockForFulfilment(orderId, m); // DC-14: the order first, then the handover
        if (facts.status !== 'paid') throw new Problem('order-state', { errors: [{ field: 'order', reason: facts.status }] });
        const [{ first }] = (await m.query(`SELECT game_accounts.deliver($1, $2, $3, $4, $5, $6::interval) AS first`, [
          orderId,
          sellerId,
          d.keyVersion,
          enc,
          ciphertext,
          window,
        ])) as { first: boolean }[];
        const [h] = (await m.query(`SELECT delivered_at, takeover_due_at FROM game_accounts.handovers WHERE order_id = $1`, [orderId])) as {
          delivered_at: Date;
          takeover_due_at: Date;
        }[];
        if (first) await this.escrow.recordFulfilmentStep(orderId, 'credentials_delivered', h.delivered_at, m); // not again after a re-key
        return h;
      })
      .catch(refusal);
    await this.notice(
      o.buyerId,
      'game.credentials_delivered',
      { listing_title: o.listing.title, hours: this.hoursUntil(r.takeover_due_at) },
      `game:${orderId}:delivered:${d.keyVersion}`,
    );
    return { deliveredAt: r.delivered_at.toISOString(), takeoverDueAt: r.takeover_due_at.toISOString() };
  }

  /** GET /orders/{id}/game/sealed (FR-GAM-11): the buyer's retrieval, logged with the session and address. */
  async retrieve(buyerId: string, orderId: string, sessionId: string, ip: string | null): Promise<{ keyVersion: number; enc: string; ciphertext: string }> {
    const o = await this.gameOrder(buyerId, orderId);
    if (o.role !== 'buyer') throw new Problem('forbidden');
    const [s] = (await this.db
      .query(`SELECT key_version, enc, ciphertext FROM game_accounts.fetch_sealed($1, $2, $3, $4::inet)`, [orderId, buyerId, sessionId, ip])
      .catch(refusal)) as { key_version: number; enc: Buffer; ciphertext: Buffer }[];
    if (!s) throw new Problem('not-found');
    return { keyVersion: s.key_version, enc: s.enc.toString('base64url'), ciphertext: s.ciphertext.toString('base64url') };
  }

  /**
   * orders.escrow.released, .refunded, .partially_refunded (FR-GAM-19, FR-GAM-04): the ciphertext is deleted; the
   * handover is cancelled if the buyer never took the account over (and it is not in dispute), otherwise closed; the
   * listing's player-ID claim is released either way.
   */
  async onEscrowClosed(e: OutboxEvent): Promise<boolean> {
    const orderId = str(e.payload.orderId) || e.aggregateId;
    return this.db.transaction(async (m: EntityManager) => {
      const [h] = (await m.query(`SELECT status, taken_over_at, listing_id FROM game_accounts.handovers WHERE order_id = $1 FOR UPDATE`, [orderId])) as {
        status: string;
        taken_over_at: Date | null;
        listing_id: string;
      }[];
      if (!h) return false; // not a game account
      if (h.status !== 'cancelled' && h.status !== 'closed') {
        await m.query(`SELECT game_accounts.finish($1, $2)`, [orderId, h.taken_over_at === null && h.status !== 'disputed']);
      }
      await m.query(`UPDATE game_accounts.claims SET released_at = now(), release_reason = 'escrow_terminal' WHERE listing_id = $1 AND released_at IS NULL`, [
        h.listing_id,
      ]);
      return true;
    });
  }

  /** orders.order.cancelled: an unpaid order's handover is cancelled. */
  async onCancelled(e: OutboxEvent): Promise<number> {
    const [, n] = (await this.db.query(
      `UPDATE game_accounts.handovers SET status = 'cancelled', cancelled_at = now() WHERE order_id = $1 AND status = 'preparing'`,
      [str(e.payload.orderId) || e.aggregateId],
    )) as [unknown, number];
    return n;
  }

  private hoursUntil(at: Date): number {
    return Math.max(1, Math.round((at.getTime() - this.clock.now().getTime()) / 3_600_000));
  }

  private async notice(userId: string, template: string, params: Record<string, string | number>, key: string): Promise<void> {
    if (!userId) return;
    await this.notifier.notify(userId, template, params, key).catch((err: Error) => this.log.warn(`notice ${template} to ${userId}: ${err.message}`));
  }

  private async featureOn(): Promise<void> {
    if ((await this.params.current()).get<boolean>('CP-36') !== true) throw new Problem('feature-off'); // FR-GAM-01
  }

  /** The order, for a party of it (not-found otherwise, and for an order that is not a game account). */
  private async gameOrder(userId: string, orderId: string, role?: 'buyer') {
    const o = await this.orders.getOrderForParty(orderId, userId);
    if (o.listing.itemKind !== 'game_account') throw new Problem('not-found');
    if (role && o.role !== role) throw new Problem('forbidden');
    return o;
  }
}

/** The database's refusals of a delivery or a retrieval, as the API's problems. */
function refusal(err: unknown): never {
  if (err instanceof QueryFailedError) {
    const d = err.driverError as { message?: string; code?: string; constraint?: string };
    const hit = DELIVERY_REFUSALS.find(([part]) => d.message?.includes(part));
    if (hit) throw new Problem(hit[1], { errors: [{ field: hit[2], reason: hit[3] }] });
    if (d.code === '23514' && d.constraint) throw new Problem('validation-failed', { errors: [{ field: 'ciphertext', reason: d.constraint }] });
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
