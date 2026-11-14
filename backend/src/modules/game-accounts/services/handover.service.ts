import { Inject, Injectable } from '@nestjs/common';
import { createPublicKey } from 'crypto';
import { DataSource, QueryFailedError } from 'typeorm';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import type { OutboxEvent } from '../../../kernel/events/event-bus';
import { Problem } from '../../../kernel/http/problems';
import { ORDERS_PORT, OrdersPort } from '../../orders/ports';
import { DISCLOSURE_VERSION, GameAccountPort } from '../ports';

// The handover's checkout side (docs/design/05_game_accounts.pdf section 6; FR-GAM-05, FR-GAM-07, FR-GAM-10, I-29;
// U5-03, first part): HandoverService.
//  - The buyer acknowledges the publisher-risk disclosure, by version, on an unpaid game-account order: the handover
//    starts as preparing, without a key.
//  - The buyer's browser registers its public key (an uncompressed P-256 point, 65 bytes): version 1, fixed until the
//    order is paid (game_accounts.register_key). The server checks the point lies on the curve.
//  - Unit 2 starts a payment only when assertCheckoutReady passes (CP-36 on, disclosure and key).
//  - When the order is paid, the seller is asked for the credentials by the order's CP-22 deadline (mark_paid), and the
//    listing's player-ID claim names the order. An order cancelled unpaid cancels its handover.
// No response ever carries the key or a fingerprint (section 6.3). The sealed delivery and retrieval are the second part.

/** SubjectPublicKeyInfo header of an uncompressed P-256 point (RFC 5480), to let OpenSSL check the point. */
const P256_SPKI = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
const B64URL = /^[A-Za-z0-9_-]+$/;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

interface HandoverRow {
  status: string; disclosure_version: number; disclosure_ack_at: Date; key_version: number; rekeys_used: number;
  credentials_due_at: Date | null; first_delivered_at: Date | null; delivered_at: Date | null; takeover_due_at: Date | null;
  rekey_due_at: Date | null; taken_over_at: Date | null; cancelled_at: Date | null; closed_at: Date | null;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

@Injectable()
export class HandoverService implements GameAccountPort {
  constructor(
    private readonly db: DataSource,
    @Inject(ORDERS_PORT) private readonly orders: OrdersPort,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
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
    if (raw.length !== 65 || raw[0] !== 4 || !onCurve(raw)) throw new Problem('validation-failed', { errors: [{ field: 'publicKey', reason: 'not-a-p256-point' }] });
    try {
      const [{ version }] = (await this.db.query(`SELECT game_accounts.register_key($1, $2, $3, $4) AS version`, [orderId, buyerId, raw, sessionId])) as { version: number }[];
      return { keyVersion: version };
    } catch (err) {
      const message = err instanceof QueryFailedError ? ((err.driverError as { message?: string }).message ?? '') : '';
      if (message.includes('acknowledge the disclosure first')) throw new Problem('validation-failed', { errors: [{ field: 'disclosure', reason: 'not-acknowledged' }] });
      if (message.includes('the key is fixed')) throw new Problem('validation-failed', { errors: [{ field: 'publicKey', reason: 'key-fixed' }] });
      throw err;
    }
  }

  /** GET /orders/{id}/game: the handover as either party sees it; never the key, a fingerprint or a ciphertext. */
  async view(userId: string, orderId: string) {
    const o = await this.gameOrder(userId, orderId);
    const [h] = (await this.db.query(`SELECT * FROM game_accounts.handovers WHERE order_id = $1`, [orderId])) as HandoverRow[];
    return {
      orderId, role: o.role, disclosure: { currentVersion: DISCLOSURE_VERSION, acknowledgedVersion: h?.disclosure_version ?? null, acknowledgedAt: iso(h?.disclosure_ack_at ?? null) },
      status: h?.status ?? null, keyVersion: h?.key_version ?? 0, rekeysUsed: h?.rekeys_used ?? 0,
      credentialsDueAt: iso(h?.credentials_due_at ?? null), firstDeliveredAt: iso(h?.first_delivered_at ?? null), deliveredAt: iso(h?.delivered_at ?? null),
      takeoverDueAt: iso(h?.takeover_due_at ?? null), rekeyDueAt: iso(h?.rekey_due_at ?? null), takenOverAt: iso(h?.taken_over_at ?? null),
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
    return this.db.transaction(async (m) => {
      const [h] = (await m.query(`SELECT status, listing_id FROM game_accounts.handovers WHERE order_id = $1 FOR UPDATE`, [orderId])) as { status: string; listing_id: string }[];
      if (!h) throw new Error(`orders.order.paid ${e.id}: game-account order ${orderId} has no handover`); // payment needs one (assertCheckoutReady)
      if (h.status !== 'preparing') return false; // delivered twice
      await m.query(`SELECT game_accounts.mark_paid($1, $2)`, [orderId, due]);
      await m.query(`UPDATE game_accounts.claims SET order_id = $2 WHERE listing_id = $1 AND released_at IS NULL AND order_id IS NULL`, [h.listing_id, orderId]);
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

function onCurve(raw: Buffer): boolean {
  try {
    createPublicKey({ key: Buffer.concat([P256_SPKI, raw]), format: 'der', type: 'spki' });
    return true;
  } catch {
    return false;
  }
}
