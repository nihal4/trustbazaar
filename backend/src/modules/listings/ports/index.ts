import type { EntityManager } from 'typeorm';

// The public surface of Unit 3: the only files other units may import (DC-1).
// Ports this unit provides (docs/design/03_listings_auctions.pdf section 3.3; docs/design/09_integration.pdf
// section 4), added by the unit's tasks:
//   ListingsPort      (U3-02, below)
//   ListingsCommands  (approveForPublication, returnToDraft: U5-02, below; remove: U3-08)
//   ListingsQueries   (I-61: threadFacts with U6-02, below; fulfilmentFacts with U3-06)
//   AuctionQuery      (U3-04: getPublicState, below; U3-06: getFlags)

export type ItemKind = 'physical' | 'game_account';
export type SaleFormat = 'fixed_price' | 'auction';
export type ListingStatus = 'draft' | 'pending_review' | 'active' | 'sold' | 'ended_unsold' | 'cancelled' | 'removed';
export type Fulfilment = 'pickup_only' | 'courier_only' | 'pickup_or_courier';
export type WeightClass = 'up_to_1kg' | 'up_to_2kg' | 'up_to_5kg' | 'up_to_10kg' | 'over_10kg';
export type SizeClass = 'small' | 'medium' | 'large' | 'oversize';
export type ItemCondition = 'new' | 'like_new' | 'used' | 'for_parts';

/** What the order stores of the listing at checkout (DR-03): the terms the buyer saw. Money in poisha, as a string. */
export interface ListingSnapshot {
  listingId: string;
  sellerId: string;
  itemKind: ItemKind;
  saleFormat: SaleFormat;
  status: ListingStatus;
  category: { id: number; slug: string; nameEn: string; nameBn: string };
  title: string;
  description: string;
  condition: ItemCondition | null;
  noVisibleDefects: boolean | null;
  fulfilmentOptions: Fulfilment | null;
  weightClass: WeightClass | null;
  sizeClass: SizeClass | null;
  district: string | null;
  price: string | null;
  clarifications: { body: string; at: string }[];
  /** The storage keys of the photos shown, in order (served at /api/v1/listing-photos/{key}). */
  photoKeys: string[];
  capturedAt: string;
  /** U10-23: a keyed hash of the device's identifier and its last four characters, for the meetup check; the hash is never shown */
  serialDigest?: string | null;
  serialLast4?: string | null;
}

/**
 * Stock (DC-13; I-9, I-14): used by Unit 2 inside its own transaction. Each call is one conditional update
 * (listings.reserve, release, mark_sold), so concurrent buyers can never take more units than exist.
 */
export interface ListingsPort {
  /** false = not available: not active, seller hidden, not fixed price, or too few units left (FR-FIX-05). */
  reserve(listingId: string, qty: number, tx: EntityManager): Promise<boolean>;
  release(listingId: string, qty: number, tx: EntityManager): Promise<void>;
  /** Reserved units become sold; the listing is sold when nothing is left (FR-FIX-04). */
  markSold(listingId: string, qty: number, tx: EntityManager): Promise<void>;
  /** Throws not-found for an unknown listing. */
  snapshot(listingId: string, tx?: EntityManager): Promise<ListingSnapshot>;
}

export const LISTINGS_PORT = Symbol('LISTINGS_PORT');

/**
 * Publication decisions on a listing held for review (section 3.3; used by Units 5 and 7). Each runs in the caller's
 * transaction when one is given, so Unit 5's ownership approval, its player-ID claim and the publication commit
 * together. remove() came with U3-08.
 */
export interface ListingsCommands {
  /** pending_review -> active; a held auction's clock restarts now. Throws listing-state if the listing is not held. */
  approveForPublication(listingId: string, byStaffId: string, reason: string, tx?: EntityManager): Promise<void>;
  /** pending_review -> draft, for the seller to correct. Returns false (and changes nothing) if the listing is not held. */
  returnToDraft(listingId: string, byStaffId: string, reason: string, tx?: EntityManager): Promise<boolean>;
  /**
   * FR-LST-12: an active or held listing is removed for a policy breach, with the reason; an open auction on it is
   * cancelled (its bidders are told). Throws listing-state otherwise.
   */
  remove(listingId: string, byStaffId: string, reason: string, tx?: EntityManager): Promise<void>;
}

export const LISTINGS_COMMANDS = Symbol('LISTINGS_COMMANDS');

/**
 * The public state of an auction (section 3.2, IF-COM-02): the body of GET /auctions/{id}/state and of the live
 * auction.state message. Money in poisha, as strings. Never a maximum, the reserve amount or an identity
 * (FR-AUC-08): the leader is the auction's alias ("Bidder 2"). seq is the auction's version (FR-AUC-11).
 */
export interface AuctionState {
  auctionId: string;
  status: 'open' | 'awarded' | 'unsold' | 'cancelled';
  startPrice: string;
  /** null before the first bid */
  price: string | null;
  bidCount: number;
  leaderAlias: number | null;
  endAt: string;
  hasReserve: boolean;
  reserveMet: boolean;
  /** The lowest maximum another bidder may send now (CP-08); null once the auction is closed. */
  minimumBid: string | null;
  /** The database server's time, for the countdown on the server's clock (FR-AUC-01). */
  serverTime: string;
  seq: number;
}

/** A shill-bidding flag on an auction (FR-AUC-18; auctions.flags). The bidders are named by their alias. */
export interface Flag {
  id: string;
  auctionId: string;
  kind: 'new_account_cluster' | 'linked_to_seller' | 'last_second_pattern' | 'self_outbid_pattern';
  /** 0 to 1 */
  score: number;
  detail: Record<string, unknown>;
  createdAt: string;
  reviewedAt: string | null;
}

/** Used by Units 2 and 7. */
export interface AuctionQuery {
  /** Throws not-found for an unknown auction. */
  getPublicState(auctionId: string): Promise<AuctionState>;
  /** The auction's flags, newest first (U3-06); empty for an unknown auction. */
  getFlags(auctionId: string): Promise<Flag[]>;
}

export const AUCTION_QUERY = Symbol('AUCTION_QUERY');

/** Unit 4's names for the ways an item can change hands (Unit 2 OrderView.fulfilmentOptions). */
export type FulfilmentMethod = 'self_pickup' | 'courier';

/** docs/design/09_integration.pdf section 4 (I-61, I-23). fulfilmentFacts is used by Unit 4, threadFacts by Unit 6. */
export interface ListingsQueries {
  /**
   * What a delivery quote and a meetup need (I-23): the methods offered, the parcel classes (a superset of section 4:
   * Unit 4 section 3.3 names the weight class too), the district and the rounded coordinates. Throws not-found for an
   * unknown listing or a game account (no fulfilment).
   */
  fulfilmentFacts(listingId: string): Promise<{
    options: FulfilmentMethod[]; weightClass: WeightClass | null; sizeClass: SizeClass | null; district: string; approxLat: number; approxLng: number;
  }>;
  /** The listing a chat thread is about: its seller, title and status. Throws not-found for an unknown listing. */
  threadFacts(listingId: string): Promise<{ sellerId: string; title: string; status: ListingStatus }>;
  /** FR-LST-11, FR-OPS-01: listings held for review by the screening terms, oldest first (game accounts are Unit 5's queue). */
  reviewQueue(limit?: number): Promise<ReviewItem[]>;
}

export interface ReviewItem {
  listingId: string;
  sellerId: string;
  title: string;
  heldAt: Date;
  /** The screening terms that held it, as recorded at publication. */
  reason: string | null;
}

export const LISTINGS_QUERIES = Symbol('LISTINGS_QUERIES');

/** This unit's part of the data export (FR-PRV-03; U7-11): a DataExportSource (kernel/privacy/data-export.ts). */
export const LISTINGS_DATA_EXPORT = Symbol('LISTINGS_DATA_EXPORT');
