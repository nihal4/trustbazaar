// What Unit 3 answers for a listing and an auction (docs/design/03_listings_auctions.pdf section 3; Decisions log,
// U3-03 to U3-05). Money in poisha, as strings; times as ISO strings.
export interface AuctionState {
  auctionId: string;
  status: 'open' | 'awarded' | 'unsold' | 'cancelled';
  startPrice: string;
  price: string | null;
  bidCount: number;
  leaderAlias: number | null;
  endAt: string;
  hasReserve: boolean;
  reserveMet: boolean;
  minimumBid: string | null;
  serverTime: string;
  seq: number;
}

export interface ListingView {
  id: string;
  itemKind: 'physical' | 'game_account';
  saleFormat: 'fixed_price' | 'auction';
  status: 'draft' | 'pending_review' | 'active' | 'sold' | 'ended_unsold' | 'cancelled' | 'removed';
  category: { id: number; slug: string; nameEn: string; nameBn: string };
  title: string;
  description: string;
  condition: 'new' | 'like_new' | 'used' | 'for_parts' | null;
  noVisibleDefects: boolean | null;
  fulfilmentOptions: 'pickup_only' | 'courier_only' | 'pickup_or_courier' | null;
  district: string | null;
  price: string | null;
  quantity: { total: number; available: number };
  currentlyReserved: boolean;
  photos: { id: string; position: number; url: string; thumbUrl: string; width: number; height: number; showsDefects: boolean }[];
  clarifications: { id: string; body: string; at: string }[];
  auction: (AuctionState & { reservePrice?: string | null }) | null;
  seller: { id: string; displayName: string; verified: boolean; joinMonth: string };
  own?: unknown;
}

export interface MyStatus {
  hasBid: boolean;
  yourMaximum: string | null;
  leading: boolean;
  yourAlias: number | null;
  orderId: string | null;
  secondChanceOffer: { id: string; price: string; expiresAt: string } | null;
}

export interface BidHistory { items: { id: string; bidderAlias: number; amount: string; leading: boolean; at: string }[] }

export interface BidResult { bidId: string; outcome: 'leading' | 'outbid' | 'raised_own_max'; yourMaximum: string; state: AuctionState }

export const listingKey = (id: string) => ['listings', id] as const;
export const stateKey = (id: string) => ['auctions', id, 'state'] as const;
export const myStatusKey = (id: string) => ['auctions', id, 'my-status'] as const;
export const historyKey = (id: string) => ['auctions', id, 'bids'] as const;
