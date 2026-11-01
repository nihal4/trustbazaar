import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus, OutboxEvent } from '../../../kernel/events/event-bus';
import { LISTINGS_PORT, ListingsPort } from '../../listings/ports';
import { NotificationService, Subject } from '../services/notification.service';
import { taka } from '../services/templates';

// Events of Units 1 to 3 turned into notices (docs/design/06_chat_notifications.pdf section 3.4; FR-NTF-03,
// FR-NTF-06; U6-04). One consumer per event type; each decides the recipients and the template. The dedupe key
// is the event's outbox and id with the template, so an event delivered twice, or ten times at once, creates one
// notice per recipient (DC-6). Consumers for Units 3 (auctions), 4, 5 and 7 are added with those units' events,
// and the deadline reminders of the same table with U6-05.
type Notice = { to: unknown; code: string; params?: Record<string, string | number | boolean>; subject?: Subject };
type Mapper = (e: OutboxEvent) => Promise<Notice[]> | Notice[];

const CONSUMER = 'chat.notifications';
const str = (v: unknown) => (typeof v === 'string' ? v : '');

@Injectable()
export class NotificationConsumers implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly notices: NotificationService,
    @Inject(LISTINGS_PORT) private readonly listings: ListingsPort,
  ) {}

  /** Event type -> the notices it makes. */
  readonly map: Record<string, Mapper> = {
    // security notices: app, e-mail and SMS; they cannot be switched off (FR-NTF-06)
    'identity.signin.new_device': (e) => [{ to: e.payload.userId, code: 'security.new_device', params: { device: str(e.payload.device).slice(0, 80) || '?' } }],
    'identity.password.changed': (e) => [{ to: e.payload.userId, code: 'security.password_changed' }],
    'identity.contact.changed': (e) => [{ to: e.payload.userId, code: e.payload.kind === 'email' ? 'security.email_changed' : 'security.phone_changed' }],
    'identity.mfa.enabled': (e) => [{ to: e.payload.userId, code: 'security.mfa_enabled' }],
    'identity.mfa.disabled': (e) => [{ to: e.payload.userId, code: 'security.mfa_disabled' }],
    'payments.payout_account.changed': (e) => [{ to: e.payload.userId, code: 'security.payout_account_changed' }],
    // account (FR-NTF-03, FR-TNS-03)
    'identity.kyc.verified': (e) => [{ to: e.payload.userId, code: 'account.kyc_verified' }],
    'identity.kyc.rejected': (e) => [{ to: e.payload.userId, code: 'account.kyc_rejected' }],
    'identity.kyc.revoked': (e) => [{ to: e.payload.userId, code: 'account.kyc_revoked' }],
    'identity.account.suspended': (e) => [{ to: e.payload.userId, code: 'account.suspended' }],
    'identity.account.reinstated': (e) => [{ to: e.payload.userId, code: 'account.reinstated' }],
    'payments.payout_account.reviewed': (e) => [{ to: e.payload.userId, code: e.payload.decision === 'approve' ? 'payment.payout_account_approved' : 'payment.payout_account_rejected' }],
    // orders (FR-NTF-03)
    'orders.order.created': (e) => (e.payload.kind === 'fixed_price' ? [] : [this.order(e, e.payload.buyerId, 'order.auction_won', { amount_bdt: taka(e.payload.total) })]),
    'orders.order.paid': (e) => [
      this.order(e, e.payload.buyerId, 'order.paid_buyer', { amount_bdt: taka(e.payload.total) }),
      this.order(e, e.payload.sellerId, 'order.paid_seller'),
    ],
    'orders.order.cancelled': (e) =>
      e.payload.reason === 'checkout_expired' || e.payload.reason === 'payment_window_expired' ? [this.order(e, e.payload.buyerId, 'order.unpaid_cancelled')] : [],
    'orders.order.delivered': (e) => [this.order(e, e.payload.buyerId, 'order.delivered'), this.order(e, e.payload.sellerId, 'order.delivered')],
    'orders.cancellation.requested': (e) => [this.order(e, e.payload.sellerId, 'order.cancellation_requested')],
    'orders.cancellation.declined': (e) => [this.order(e, e.payload.buyerId, 'order.cancellation_declined')],
    'orders.order.cancelled_by_seller': (e) => [this.order(e, e.payload.buyerId, 'order.cancelled_by_seller')],
    'orders.escrow.released': (e) => [
      this.order(e, e.payload.buyerId, 'escrow.released_buyer'),
      this.order(e, e.payload.sellerId, 'escrow.released_seller', { amount_bdt: taka(e.payload.sellerPayout) }),
    ],
    'orders.escrow.refunded': (e) => [
      this.order(e, e.payload.buyerId, 'escrow.refunded_buyer', { amount_bdt: taka(e.payload.refunded) }),
      this.order(e, e.payload.sellerId, 'escrow.refunded_seller'),
    ],
    'orders.escrow.partially_refunded': (e) => [
      this.order(e, e.payload.buyerId, 'escrow.partly_refunded_buyer', { amount_bdt: taka(e.payload.refunded) }),
      this.order(e, e.payload.sellerId, 'escrow.partly_refunded_seller', { amount_bdt: taka(e.payload.sellerPayout) }),
    ],
    'orders.escrow.frozen': (e) => [this.order(e, e.payload.buyerId, 'escrow.frozen'), this.order(e, e.payload.sellerId, 'escrow.frozen')],
    // payments
    'payments.refund.succeeded': (e) => [{ to: e.payload.buyerId, code: 'payment.refund_sent', params: { amount_bdt: taka(e.payload.amount) }, subject: this.subjectOf(e) }],
    'payments.refund.manual_required': (e) => [{ to: e.payload.buyerId, code: 'payment.refund_delayed', params: { amount_bdt: taka(e.payload.amount) }, subject: this.subjectOf(e) }],
    'payments.payout.sent': (e) => [{ to: e.payload.sellerId, code: 'payment.payout_sent', params: { amount_bdt: taka(e.payload.amount) }, subject: this.subjectOf(e) }],
    'payments.payout.failed': (e) => [{ to: e.payload.sellerId, code: 'payment.payout_failed', params: { amount_bdt: taka(e.payload.amount) }, subject: this.subjectOf(e) }],
    // listings
    'listings.listing.published': async (e) => {
      const listingId = str(e.payload.listingId);
      const title = (await this.listings.snapshot(listingId)).title;
      return [{ to: e.payload.sellerId, code: 'listing.published', params: { listing_title: title }, subject: { type: 'listing', id: listingId } }];
    },
  };

  onModuleInit(): void {
    for (const type of Object.keys(this.map)) this.bus.on(type, CONSUMER, async (e) => void (await this.handle(e)));
  }

  /** Creates the event's notices; a notice already made by an earlier delivery is skipped by its dedupe key. */
  async handle(e: OutboxEvent): Promise<number> {
    const mapper = this.map[e.type];
    if (!mapper) return 0;
    let made = 0;
    for (const n of await mapper(e)) {
      if (typeof n.to !== 'string' || !n.to) throw new Error(`${e.type} ${e.id}: no recipient for ${n.code}`); // retried, then reported (K-04)
      if (await this.notices.create(n.to, n.code, n.params ?? {}, `${e.outbox}:${e.id}:${n.code}`, n.subject)) made++;
    }
    return made;
  }

  private order(e: OutboxEvent, to: unknown, code: string, extra: Record<string, number> = {}): Notice {
    return { to, code, params: { listing_title: str(e.payload.listingTitle) || '—', ...extra }, subject: { type: 'order', id: str(e.payload.orderId) || e.aggregateId } };
  }

  private subjectOf(e: OutboxEvent): Subject | undefined {
    const orderId = str(e.payload.orderId);
    return orderId ? { type: 'order', id: orderId } : undefined;
  }
}
