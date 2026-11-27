import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import { AUDIT_SERVICE, AuditServicePort, IDENTITY_QUERY, IdentityQuery } from '../../identity/ports';
import { FULFILMENT_ORDERS, FulfilmentOrders } from '../adapters/orders';
import { deviceDigest } from '../../../kernel/device-identifier';
import { FILE_VAULT, FileVaultPort } from '../../identity/ports';
import { codeMatches, deriveCode } from './handover-code';
import { mapUrl, MeetupPointsService, pointView, type PointView } from './meetup-points.service';
import { announceNewIssues } from './outbox';
import { fromDeliveryDb, refusal } from './refusals';

// Meetup handover (docs/design/04_delivery.pdf section 6; FR-DLV-03 to FR-DLV-06; DC-14; U4-03). The database decides:
// delivery.propose_meetup, respond_meetup, record_code_entry and unlock_code. This service checks who is asking,
// derives the code (never stored, never logged), compares it in constant time, and on a correct entry records the
// fulfilment step and the delivery event through Unit 2's EscrowCommands in the same transaction, after locking the
// order first (DC-14). No cash changes hands anywhere: the item is already paid for (FR-DLV-05).

/** DV-26: at least this far ahead, and at least this long before the handover deadline. */
const MEETUP_LEAD = '1 hour';
const MEETUP_BUFFER = '2 hours';

type HandoverStatus = 'arranging' | 'agreed' | 'completed' | 'locked' | 'cancelled';
interface HandoverRow {
  order_id: string;
  buyer_id: string;
  seller_id: string;
  status: HandoverStatus;
  due_at: Date;
  code_version: number;
  wrong_entries: number;
  agreed_proposal_id: string | null;
  locked_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
}
/** A place of the parties' own (FR-DLV-04; Decisions log, U4-03): shown with a safety notice by the client. */
interface OwnPlaceView {
  name: string;
  lat: number | null;
  lng: number | null;
  mapUrl: string | null;
}
interface ProposalView {
  id: string;
  byMe: boolean;
  meetAt: string;
  note: string | null;
  /** exactly one of the two: a suggested point (FR-DLV-03) or a place of the parties' own */
  point: PointView | null;
  place: OwnPlaceView | null;
  status: 'proposed' | 'accepted' | 'declined' | 'withdrawn' | 'superseded' | 'lapsed';
  createdAt: string;
}
export interface HandoverView {
  orderId: string;
  role: 'buyer' | 'seller';
  status: HandoverStatus;
  dueAt: string;
  /** the open proposal, if any, and the agreed one; then the history, newest first */
  proposals: ProposalView[];
  agreed: { point: PointView | null; place: OwnPlaceView | null; meetAt: string } | null;
  suggestions: PointView[];
  /** buyer only, while the handover is open: the code and its instruction key (section 6.4) */
  code: string | null;
  /**
   * U10-23: an item with a device identifier (a phone's IMEI, a laptop's serial number) is checked by the buyer at the meetup before the code is shown:
   * `required`, whether it `matched`, and the last four characters the listing showed. Null for an item without one.
   */
  deviceCheck: { required: boolean; matched: boolean; last4: string; attemptsLeft: number } | null;
  /** seller only: how many photos of the item the seller has added at this handover (U10-23) */
  photoCount: number | null;
  /** seller only */
  attemptsLeft: number | null;
  completedAt: string | null;
  lockedAt: string | null;
}

const ACTIVE: HandoverStatus[] = ['arranging', 'agreed'];
/** U10-23: photos the seller may add to one handover. */
const MAX_HANDOVER_PHOTOS = 3;
/** U10-23: wrong tries of the device check before it is locked (a mistyped digit is allowed). */
const DEVICE_TRIES = 5;

const ownPlace = (name: string, lat: string | null, lng: string | null): OwnPlaceView => {
  const la = lat === null ? null : Number(lat);
  const lo = lng === null ? null : Number(lng);
  return { name, lat: la, lng: lo, mapUrl: la !== null && lo !== null ? mapUrl(la, lo) : null };
};

@Injectable()
export class HandoverService {
  constructor(
    private readonly db: DataSource,
    private readonly points: MeetupPointsService,
    @Inject(FULFILMENT_ORDERS) private readonly orders: FulfilmentOrders,
    @Inject(IDENTITY_QUERY) private readonly identity: IdentityQuery,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(FILE_VAULT) private readonly vault: FileVaultPort,
  ) {}

  // ---------------------------------------------------------------- created and closed by events (section 6.1, 6.5)

  /** orders.order.paid for a self-pickup order: the handover, due at the order's fulfilment deadline (CP-15). Idempotent. */
  async open(o: { orderId: string; buyerId: string; sellerId: string; dueAt: string }): Promise<void> {
    await this.db.query(`INSERT INTO delivery.handovers (order_id, buyer_id, seller_id, due_at) VALUES ($1, $2, $3, $4) ON CONFLICT (order_id) DO NOTHING`, [
      o.orderId,
      o.buyerId,
      o.sellerId,
      o.dueAt,
    ]);
  }

  /** orders.escrow.refunded: an open or locked handover is cancelled, and an open proposal with it. Idempotent. */
  async cancel(orderId: string): Promise<void> {
    await this.db.transaction(async (m) => {
      const [h] = (await m.query(`SELECT status FROM delivery.handovers WHERE order_id = $1 FOR UPDATE`, [orderId])) as { status: HandoverStatus }[];
      if (!h || !['arranging', 'agreed', 'locked'].includes(h.status)) return;
      await m.query(`UPDATE delivery.meetup_proposals SET status = 'superseded', responded_at = now() WHERE order_id = $1 AND status = 'proposed'`, [orderId]);
      await m.query(`UPDATE delivery.handovers SET status = 'cancelled', cancelled_at = now() WHERE order_id = $1`, [orderId]);
    });
  }

  // ---------------------------------------------------------------- the order view's handover (section 3.1)

  /** GET /orders/{id}/handover: the buyer sees the code; the seller the attempts left; nobody else anything. */
  async view(userId: string, orderId: string): Promise<HandoverView> {
    const h = await this.party(this.db.manager, orderId, userId);
    const buyer = h.buyer_id === userId;
    const proposals = (await this.db.query(
      `SELECT p.id, p.proposed_by, p.meet_at, p.note, p.status, p.created_at, p.place_name, p.place_lat::text, p.place_lng::text,
              m.id AS point_id, m.kind, m.name_en, m.name_bn, m.district, m.lat::text, m.lng::text, m.guidance, m.active
         FROM delivery.meetup_proposals p LEFT JOIN delivery.meetup_points m ON m.id = p.point_id
        WHERE p.order_id = $1 ORDER BY (p.status = 'proposed') DESC, p.created_at DESC, p.id`,
      [orderId],
    )) as {
      id: string;
      proposed_by: string;
      meet_at: Date;
      note: string | null;
      status: ProposalView['status'];
      created_at: Date;
      place_name: string | null;
      place_lat: string | null;
      place_lng: string | null;
      point_id: string | null;
      kind: PointView['kind'];
      name_en: string;
      name_bn: string;
      district: string;
      lat: string;
      lng: string;
      guidance: string | null;
      active: boolean;
    }[];
    const items: ProposalView[] = proposals.map((p) => ({
      id: p.id,
      byMe: p.proposed_by === userId,
      meetAt: p.meet_at.toISOString(),
      note: p.note,
      status: p.status,
      createdAt: p.created_at.toISOString(),
      point: p.point_id
        ? pointView({
            id: p.point_id,
            kind: p.kind,
            name_en: p.name_en,
            name_bn: p.name_bn,
            district: p.district,
            lat: p.lat,
            lng: p.lng,
            guidance: p.guidance,
            active: p.active,
          })
        : null,
      place: p.place_name ? ownPlace(p.place_name, p.place_lat, p.place_lng) : null,
    }));
    const agreed = items.find((p) => p.id === h.agreed_proposal_id && p.status === 'accepted') ?? null;
    const open = ACTIVE.includes(h.status);
    const maxWrong = (await this.params.current()).get<number>('CP-45');
    const device = buyer && open ? await this.deviceState(orderId, h.buyer_id) : null;
    return {
      orderId,
      role: buyer ? 'buyer' : 'seller',
      status: h.status,
      dueAt: h.due_at.toISOString(),
      proposals: items,
      agreed: agreed ? { point: agreed.point, place: agreed.place, meetAt: agreed.meetAt } : null,
      suggestions: open ? await this.suggestions(h) : [],
      // the code is shown only once the device is checked, when the item has an identifier
      code: buyer && open && (!device || device.matched) ? deriveCode(this.config.secrets.handoverKey.reveal(), orderId, h.code_version) : null,
      deviceCheck: device ? { required: true, matched: device.matched, last4: device.last4, attemptsLeft: device.attemptsLeft } : null,
      photoCount: buyer
        ? null
        : (((await this.db.query(`SELECT count(*)::int AS n FROM delivery.handover_photos WHERE order_id = $1`, [orderId])) as { n: number }[])[0]?.n ?? 0),
      attemptsLeft: buyer ? null : Math.max(0, maxWrong - h.wrong_entries),
      completedAt: h.completed_at?.toISOString() ?? null,
      lockedAt: h.locked_at?.toISOString() ?? null,
    };
  }

  /** U10-23: whether the item has a device identifier, whether the buyer has matched it, and how many tries are left. */
  private async deviceState(orderId: string, buyerId: string): Promise<{ matched: boolean; last4: string; attemptsLeft: number } | null> {
    const id = await this.orders.deviceIdentifier(orderId);
    if (!id) return null;
    const rows = (await this.db.query(`SELECT matched FROM delivery.device_checks WHERE order_id = $1 AND user_id = $2`, [orderId, buyerId])) as {
      matched: boolean;
    }[];
    return { matched: rows.some((r) => r.matched), last4: id.last4, attemptsLeft: Math.max(0, DEVICE_TRIES - rows.filter((r) => !r.matched).length) };
  }

  /**
   * POST /orders/{id}/device-check (U10-23): the buyer types the identifier the device shows (*#06# on a phone); the server compares its keyed hash with the
   * listing's. Only the result is kept. A few wrong tries are allowed (a mistyped digit), then the check is locked: the buyer asks the seller to cancel.
   */
  async checkDevice(userId: string, orderId: string, typed: string): Promise<{ matched: boolean; attemptsLeft: number }> {
    const h = await this.party(this.db.manager, orderId, userId);
    if (h.buyer_id !== userId) throw new Problem('forbidden', { errors: [{ field: 'value', reason: 'buyer-only' }] });
    if (!ACTIVE.includes(h.status)) throw new Problem('validation-failed', { errors: [{ field: 'handover', reason: 'closed' }] });
    const id = await this.orders.deviceIdentifier(orderId);
    if (!id) throw new Problem('validation-failed', { errors: [{ field: 'value', reason: 'no-device' }] });
    const state = (await this.deviceState(orderId, userId))!;
    if (state.matched) return { matched: true, attemptsLeft: state.attemptsLeft };
    if (state.attemptsLeft <= 0) throw new Problem('validation-failed', { errors: [{ field: 'value', reason: 'locked' }] });
    const matched = deviceDigest(this.config.secrets.handoverKey.reveal(), typed).toString('hex') === id.digest;
    await this.db.query(`INSERT INTO delivery.device_checks (order_id, user_id, matched) VALUES ($1, $2, $3)`, [orderId, userId, matched]);
    return { matched, attemptsLeft: matched ? state.attemptsLeft : state.attemptsLeft - 1 };
  }

  /**
   * POST /orders/{id}/handover-photos (U10-23): the seller's photo of the item at the meetup, before the code is entered: re-encoded without metadata, kept
   * encrypted with the time the server received it, at most MAX_HANDOVER_PHOTOS an order; evidence for a later dispute.
   */
  /** I-63 (U10-23): the retention job's call for an order whose disputes are all purged; the file keys come back to be erased from the FileVault. */
  async purgePhotos(orderId: string): Promise<string[]> {
    return ((await this.db.query(`SELECT delivery.purge_photos($1) AS key`, [orderId])) as { key: string }[]).map((r) => r.key);
  }

  /** The seller adds a photo of the item to the order's handover; returns how many photos the handover has. */
  async addPhoto(userId: string, orderId: string, file: { buffer: Buffer; mimetype: string } | undefined): Promise<{ count: number }> {
    const h = await this.party(this.db.manager, orderId, userId);
    if (h.seller_id !== userId) throw new Problem('forbidden', { errors: [{ field: 'file', reason: 'seller-only' }] });
    if (!ACTIVE.includes(h.status)) throw new Problem('validation-failed', { errors: [{ field: 'handover', reason: 'closed' }] });
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.mimetype)) throw new Problem('validation-failed', { errors: [{ field: 'file', reason: 'type' }] });
    return this.db.transaction(async (m) => {
      await m.query(`SELECT 1 FROM delivery.handovers WHERE order_id = $1 FOR UPDATE`, [orderId]);
      const [{ n }] = (await m.query(`SELECT count(*)::int AS n FROM delivery.handover_photos WHERE order_id = $1`, [orderId])) as { n: number }[];
      if (n >= MAX_HANDOVER_PHOTOS) throw new Problem('validation-failed', { errors: [{ field: 'file', reason: 'too-many' }] });
      const stored = await this.vault.store({ purpose: 'dispute_evidence', ownerId: userId, bytes: new Uint8Array(file.buffer) });
      try {
        await m.query(`INSERT INTO delivery.handover_photos (order_id, seller_id, storage_key, sha256) VALUES ($1, $2, $3, decode($4, 'hex'))`, [
          orderId,
          userId,
          stored.key,
          stored.sha256,
        ]);
      } catch (err) {
        await this.vault.erase(stored.key).catch(() => undefined);
        throw err;
      }
      return { count: n + 1 };
    });
  }

  /** Both parties' saved approximate locations (I-24); with one missing, the points nearest the other. */
  private async suggestions(h: HandoverRow): Promise<PointView[]> {
    const [b, s] = await Promise.all([h.buyer_id, h.seller_id].map((id) => this.identity.getApproxArea(id).catch(() => null)));
    const a = b ?? s;
    const c = s ?? b;
    return a && c ? this.points.suggest(a, c) : [];
  }

  // ---------------------------------------------------------------- proposals (section 6.3; FR-DLV-04)

  /**
   * A suggested point, or a place of the parties' own: its name (plain text, 3 to 120 characters) and an optional pin
   * in Bangladesh (Decisions log, U4-03). Never both.
   */
  async propose(
    userId: string,
    orderId: string,
    p: { pointId?: string; placeName?: string; placeLat?: number; placeLng?: number; meetAt: string; note?: string },
  ): Promise<HandoverView> {
    await this.party(this.db.manager, orderId, userId);
    const note = p.note?.normalize('NFC').trim() || null;
    if (note && note.length > 200) throw new Problem('validation-failed', { errors: [{ field: 'note', reason: 'too-long' }] });
    const place = p.placeName?.normalize('NFC').trim().replace(/\s+/g, ' ') || null;
    const errors: { field: string; reason: string }[] = [];
    if (p.pointId && place) errors.push({ field: 'placeName', reason: 'point-or-own-place' });
    if (!p.pointId && !place) errors.push({ field: 'pointId', reason: 'point-or-own-place' });
    if (place && (place.length < 3 || place.length > 120)) errors.push({ field: 'placeName', reason: 'length' });
    if ((p.placeLat === undefined) !== (p.placeLng === undefined)) errors.push({ field: 'placeLat', reason: 'pin-needs-both' });
    if (p.pointId && p.placeLat !== undefined) errors.push({ field: 'placeLat', reason: 'pin-only-for-own-place' });
    if (p.placeLat !== undefined && (p.placeLat < 20 || p.placeLat > 27 || p.placeLng! < 88 || p.placeLng! > 93))
      errors.push({ field: 'placeLat', reason: 'outside-bangladesh' });
    if (errors.length) throw new Problem('validation-failed', { errors });
    await this.db
      .query(`SELECT delivery.propose_meetup($1, $2, $3, $4, $5, $6::interval, $7::interval, $8, round($9::numeric, 5), round($10::numeric, 5))`, [
        orderId,
        userId,
        p.pointId ?? null,
        p.meetAt,
        note,
        MEETUP_LEAD,
        MEETUP_BUFFER,
        place,
        p.placeLat ?? null,
        p.placeLng ?? null,
      ])
      .catch(fromDeliveryDb);
    return this.view(userId, orderId);
  }

  /** accept or decline: the other party only; a proposal whose time has passed lapses instead (it is saved). */
  async respond(userId: string, orderId: string, proposalId: string, accept: boolean): Promise<HandoverView & { outcome: string }> {
    await this.party(this.db.manager, orderId, userId);
    const [own] = (await this.db.query(`SELECT proposed_by FROM delivery.meetup_proposals WHERE id = $1 AND order_id = $2`, [proposalId, orderId])) as {
      proposed_by: string;
    }[];
    if (!own) throw new Problem('not-found');
    if (own.proposed_by === userId) throw new Problem('forbidden', { errors: [{ field: 'proposalId', reason: 'own-proposal' }] });
    const [{ outcome }] = (await this.db
      .query(`SELECT delivery.respond_meetup($1, $2, $3)::text AS outcome`, [proposalId, userId, accept])
      .catch(fromDeliveryDb)) as { outcome: string }[];
    return { ...(await this.view(userId, orderId)), outcome };
  }

  /** The proposer takes back an open proposal. */
  async withdraw(userId: string, orderId: string, proposalId: string): Promise<HandoverView> {
    await this.party(this.db.manager, orderId, userId);
    const res = (await this.db.query(
      `UPDATE delivery.meetup_proposals SET status = 'withdrawn', responded_at = now()
        WHERE id = $1 AND order_id = $2 AND proposed_by = $3 AND status = 'proposed' RETURNING id`,
      [proposalId, orderId, userId],
    )) as unknown[];
    if (((Array.isArray(res[0]) ? res[0] : res) as unknown[]).length === 0) {
      const [p] = (await this.db.query(`SELECT proposed_by FROM delivery.meetup_proposals WHERE id = $1 AND order_id = $2`, [proposalId, orderId])) as {
        proposed_by: string;
      }[];
      if (!p) throw new Problem('not-found');
      if (p.proposed_by !== userId) throw new Problem('forbidden', { errors: [{ field: 'proposalId', reason: 'not-your-proposal' }] });
      throw refusal('proposalId', 'proposal_closed');
    }
    return this.view(userId, orderId);
  }

  // ---------------------------------------------------------------- the code (section 6.4; FR-DLV-06)

  /**
   * POST /orders/{id}/handover-code: the seller's entry. One transaction (DC-14): the order, then the handover, the
   * entry logged, and on a correct code the step and the delivery event in Unit 2's escrow. A wrong or locking entry
   * is committed first and answered after, so the count cannot be undone by the refusal.
   */
  async enterCode(userId: string, orderId: string, entered: string): Promise<{ status: 'completed'; completedAt: string }> {
    const maxWrong = (await this.params.current()).get<number>('CP-45');
    const result = await this.db.transaction(async (m) => {
      const facts = await this.orders.lockForFulfilment(orderId, m);
      if (facts.sellerId !== userId) {
        throw facts.buyerId === userId ? new Problem('forbidden', { errors: [{ field: 'code', reason: 'seller-only' }] }) : new Problem('not-found');
      }
      if (facts.status !== 'paid' || facts.fulfilment !== 'self_pickup') throw refusal('handover', 'handover_closed');
      const [h] = (await m.query(`SELECT code_version, wrong_entries FROM delivery.handovers WHERE order_id = $1 FOR UPDATE`, [orderId])) as {
        code_version: number;
        wrong_entries: number;
      }[];
      if (!h) throw new Problem('not-found');
      const correct = codeMatches(entered, deriveCode(this.config.secrets.handoverKey.reveal(), orderId, h.code_version));
      const [{ r }] = (await m.query(`SELECT delivery.record_code_entry($1, $2, $3, $4) AS r`, [orderId, userId, correct, maxWrong]).catch(fromDeliveryDb)) as {
        r: 'accepted' | 'wrong' | 'locked';
      }[];
      if (r === 'locked') await announceNewIssues(m, orderId); // the code_locked issue (I-62; U4-04)
      if (r === 'accepted') {
        const at = this.clock.now();
        await this.orders.recordFulfilmentStep(orderId, 'meetup_handover', at, m);
        await this.orders.recordDeliveryEvent(orderId, 'handover_code', at, m);
        return { r, at, left: 0 };
      }
      return { r, at: null, left: Math.max(0, maxWrong - h.wrong_entries - 1) };
    });
    // the same answer whatever was entered (section 6.4): only the count of attempts left
    if (result.r === 'wrong') throw new Problem('delivery-refused', { errors: [{ field: 'code', reason: 'wrong_code', attemptsLeft: result.left }] });
    if (result.r === 'locked') throw refusal('code', 'code_locked');
    return { status: 'completed', completedAt: result.at!.toISOString() };
  }

  /** DeliveryCommands.unlockHandoverCode (through DeliveryPorts) and POST /staff/orders/{id}/handover/unlock: a new code, audited. */
  async unlockHandoverCode(orderId: string, staffId: string, reason: string): Promise<void> {
    const why = reason?.trim() ?? '';
    if (why.length < 10) throw new Problem('validation-failed', { errors: [{ field: 'reason', reason: 'too-short' }] });
    await this.db.transaction(async (m) => {
      const [h] = (await m.query(`SELECT status FROM delivery.handovers WHERE order_id = $1`, [orderId])) as { status: HandoverStatus }[];
      if (!h) throw new Problem('not-found');
      if (h.status !== 'locked') throw new Problem('validation-failed', { errors: [{ field: 'handover', reason: 'not-locked' }] });
      const [{ v }] = (await m.query(`SELECT delivery.unlock_code($1) AS v`, [orderId])) as { v: number }[];
      // the lock's issue is settled by the same decision (section 9)
      await m.query(
        `UPDATE delivery.issues SET status = 'resolved', resolved_by = $2, resolved_at = now(), resolution = $3
          WHERE order_id = $1 AND kind = 'code_locked' AND status = 'open'`,
        [orderId, staffId, `unlocked: ${why}`],
      );
      await m.query(`INSERT INTO delivery.outbox (event_type, aggregate_id, payload) VALUES ('delivery.handover.unlocked', $1, $2)`, [
        orderId,
        JSON.stringify({ orderId, codeVersion: v }),
      ]);
      await this.audit.record(
        {
          actorType: 'staff',
          actorId: staffId,
          action: 'delivery.handover.unlocked',
          objectType: 'order',
          objectId: orderId,
          after: { codeVersion: v },
          reason: why,
        },
        m,
      );
    });
  }

  /** The handover, if the user is its buyer or seller; not-found for anyone else, as for an unknown order. */
  private async party(m: EntityManager, orderId: string, userId: string): Promise<HandoverRow> {
    const [h] = (await m.query(`SELECT * FROM delivery.handovers WHERE order_id = $1`, [orderId])) as HandoverRow[];
    if (!h || (h.buyer_id !== userId && h.seller_id !== userId)) throw new Problem('not-found');
    return h;
  }
}
