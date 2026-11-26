// The order view's data (docs/design/08_frontend.pdf section 7.5; IF-UI-05; U8-06): the fields of Unit 2's
// GET /orders/{id} and Unit 4's handover and shipments that the screens read. Money in poisha, as strings.
// Query keys follow the API paths (section 4.3).

export type Fulfilment = 'self_pickup' | 'courier' | 'game_account';

export interface OrderView {
  id: string;
  kind: 'fixed_price' | 'auction' | 'second_chance';
  role: 'buyer' | 'seller';
  status: 'awaiting_payment' | 'paid' | 'cancelled' | 'closed';
  listing: { id: string; title: string; itemKind: 'physical' | 'game_account'; photoKey: string | null };
  /** The chat thread of the order's buyer and seller, null until they have written (Decisions log, U8-13). */
  threadId: string | null;
  /** The other party: the seller to the buyer, the buyer to the seller (public display name only). */
  counterparty?: { id: string; displayName: string; verified?: boolean; joinMonth?: string };
  quantity: number;
  itemPrice: string;
  deliveryFee: string;
  total: string;
  fulfilment: Fulfilment | null;
  fulfilmentOptions: Fulfilment[];
  paymentDueAt: string;
  paidAt: string | null;
  fulfilmentStep?: string | null;
  fulfilmentDueAt: string | null;
  deliveryEventAt: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  closedAt: string | null;
  createdAt?: string;
  /** FR-PAY-09: the latest cancellation request, if any; the seller answers it by id. */
  cancellationRequest?: null | { id: string; status: 'pending' | 'accepted' | 'declined' | 'lapsed'; reason: string; createdAt: string };
  escrow: null | {
    state: 'held' | 'frozen_disputed' | 'released' | 'refunded' | 'partially_refunded';
    releasePolicy: 'standard' | 'game_protection';
    amountCollected: string;
    amountRefunded: string;
    disputeWindowEndsAt?: string | null;
    autoReleaseAt: string | null;
  };
}

/** Unit 4 section 3.1: a curated public meetup point, with a map link built from its public coordinates. */
export interface MeetupPoint {
  id: string; kind: 'police_station' | 'shopping_mall' | 'bank_branch' | 'other_public'; nameEn: string; nameBn: string; district: string;
  lat: number; lng: number; guidance: string | null; active: boolean; mapUrl: string;
}
/** A place of the parties' own (Decisions log, U4-03): shown with a safety notice, never with a map link. */
export interface OwnPlace { name: string; lat: number | null; lng: number | null; mapUrl: string | null }
export interface Proposal {
  id: string; byMe: boolean; meetAt: string; note: string | null; point: MeetupPoint | null; place: OwnPlace | null;
  status: 'proposed' | 'accepted' | 'declined' | 'withdrawn' | 'superseded' | 'lapsed'; createdAt: string;
}
export interface HandoverView {
  orderId: string;
  role: 'buyer' | 'seller';
  status: 'arranging' | 'agreed' | 'completed' | 'locked' | 'cancelled';
  dueAt: string;
  proposals: Proposal[];
  agreed: { point: MeetupPoint | null; place: OwnPlace | null; meetAt: string } | null;
  suggestions: MeetupPoint[];
  /** the buyer's, while the handover is open */
  code: string | null;
  /** the seller's: how many photos of the item were added at this handover (U10-23) */
  photoCount?: number | null;
  /** the buyer's: an item with a device identifier is checked before the code is shown (U10-23) */
  deviceCheck?: { required: boolean; matched: boolean; last4: string; attemptsLeft: number } | null;
  /** the seller's */
  attemptsLeft: number | null;
  completedAt: string | null;
  lockedAt: string | null;
}

export type ShipmentStatus = 'preparing' | 'booked' | 'picked_up' | 'in_transit' | 'delivered' | 'delivery_failed' | 'returned_to_seller' | 'cancelled';
export interface Area { id: number; district: string; nameEn: string; nameBn: string }
export interface Shipment {
  id: string;
  direction: 'forward' | 'return';
  status: ShipmentStatus;
  simulated: boolean;
  provider: string;
  consignmentId: string | null;
  fee: string;
  cashToCollect: '0';
  pickupDueAt: string | null;
  bookedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  returnedAt: string | null;
  cancelledAt: string | null;
  failedAttempts: number;
  needsPickupAddress: boolean;
  /** the caller's own address only; null once erased */
  myAddress: { line1: string; line2?: string; landmark?: string; contactName: string; area: Area } | null;
  /** the other party: their district only (FR-DLV-07) */
  other: { district: string | null };
  history: { from: ShipmentStatus | null; to: ShipmentStatus; at: string }[];
}

export interface SavedAddress {
  id: string; kind: 'pickup' | 'dropoff'; label: string; line1: string; line2?: string; landmark?: string; contactName: string; area: Area; createdAt: string;
}
export interface Quote { id: string; listingId: string; quantity: number; addressId: string; fee: string; expiresAt: string; distanceKm: number }

export const orderKey = (id: string) => ['orders', id] as const;
export const handoverKey = (id: string) => ['orders', id, 'handover'] as const;
export const shipmentsKey = (id: string) => ['orders', id, 'shipments'] as const;
export const addressesKey = ['me', 'addresses'] as const;
export const areasKey = ['delivery', 'areas'] as const;
export type OrderStage = 'orders' | 'on_the_way' | 'completed';
export const ORDER_STAGES: OrderStage[] = ['orders', 'on_the_way', 'completed'];
export const ordersKey = (role: 'buyer' | 'seller', stage: OrderStage = 'orders') => ['orders', { role, stage }] as const;

export const ms = (s: string | null | undefined): number | null => (s ? Date.parse(s) : null);
