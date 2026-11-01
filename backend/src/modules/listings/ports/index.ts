import type { EntityManager } from 'typeorm';

// The public surface of Unit 3: the only files other units may import (DC-1).
// Ports this unit provides (docs/design/03_listings_auctions.pdf section 3.3; docs/design/09_integration.pdf
// section 4), added by the unit's tasks:
//   ListingsPort      (U3-02, below)
//   ListingsCommands  (U3-08)
//   ListingsQueries   (U3-06, I-61)
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

/** Used by Units 2 and 7. getFlags is added with the shill signals (U3-06). */
export interface AuctionQuery {
  /** Throws not-found for an unknown auction. */
  getPublicState(auctionId: string): Promise<AuctionState>;
}

export const AUCTION_QUERY = Symbol('AUCTION_QUERY');
