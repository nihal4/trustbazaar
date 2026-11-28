// What a dispute is on the client: its types and statuses, the two views of it, the limits on its evidence and the keys of its queries.

export type DisputeType = 'not_as_described' | 'damaged' | 'not_received' | 'credentials_invalid' | 'seller_recovery' | 'other';
export type DisputeStatus = 'open' | 'awaiting_seller' | 'under_review' | 'awaiting_return' | 'decided' | 'withdrawn';
export interface DisputeSummary {
  id: string;
  type: DisputeType;
  status: DisputeStatus;
  openedAt: string;
  outcome: string | null;
  decidedAt: string | null;
  withdrawnAt: string | null;
  unseen?: number;
}
export interface DisputeView {
  id: string;
  orderId: string;
  role: 'buyer' | 'seller';
  type: DisputeType;
  status: DisputeStatus;
  description: string | null;
  openedAt: string;
  sellerDueAt: string;
  infoDueAt: string | null;
  reviewStartedAt: string | null;
  decisionTargetAt: string | null;
  outcome: null | {
    kind: 'release' | 'full_refund' | 'partial_refund' | 'refund_after_return';
    itemRefund: string | null;
    reason: string | null;
    decidedAt: string | null;
  };
  withdrawnAt: string | null;
  /** the seller's step while the item comes back (U10-23) */
  returnStep?: { manual: boolean; last4: string | null; check: 'none' | 'matched' | 'mismatch' } | null;
  statements: { party: 'buyer' | 'seller'; text: string | null; at: string }[];
  evidence: { id: string; mime: string; size: number; at: string; link: { url: string; expiresAt: string } | null }[];
}

/** CP-33: at most 10 evidence images per dispute, 10 MB each. */
export const MAX_FILES = 10;
export const MAX_BYTES = 10_485_760;
/** Up to two videos beside the photos, 50 MB each (Decisions log, U10-23). */
export const MAX_VIDEOS = 2;
export const MAX_VIDEO_BYTES = 52_428_800;
export const IMAGE = /^image\/(jpeg|png|webp)$/;
export const VIDEO = /^video\/(mp4|quicktime|webm)$/;
/** A file the dispute accepts: a photo up to 10 MB or a video up to 50 MB. */
export const usableEvidence = (f: { type: string; size: number }) =>
  (IMAGE.test(f.type) && f.size <= MAX_BYTES) || (VIDEO.test(f.type) && f.size <= MAX_VIDEO_BYTES);
export const LIVE: DisputeStatus[] = ['open', 'awaiting_seller', 'under_review', 'awaiting_return'];
export const disputesKey = (orderId: string) => ['orders', orderId, 'disputes'] as const;
export const disputeKey = (id: string) => ['disputes', id] as const;
