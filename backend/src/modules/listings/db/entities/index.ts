import { Auction } from './auction.entity';
import { BidderAlias } from './bidder-alias.entity';
import { BiddingRestriction } from './bidding-restriction.entity';
import { Bid } from './bid.entity';
import { AuctionFlag } from './auction-flag.entity';
import { AuctionsOutboxEvent } from './auctions-outbox-event.entity';
import { SecondChanceOffer } from './second-chance-offer.entity';
import { AuctionStrike } from './auction-strike.entity';
import { Category } from './category.entity';
import { Clarification } from './clarification.entity';
import { ListingPhoto } from './listing-photo.entity';
import { Listing } from './listing.entity';
import { ScreeningTerm } from './screening-term.entity';
import { ListingStatusChange } from './listing-status-change.entity';

export { Auction } from './auction.entity';
export { BidderAlias } from './bidder-alias.entity';
export { BiddingRestriction } from './bidding-restriction.entity';
export { Bid } from './bid.entity';
export { AuctionFlag } from './auction-flag.entity';
export { AuctionsOutboxEvent } from './auctions-outbox-event.entity';
export { SecondChanceOffer } from './second-chance-offer.entity';
export { AuctionStrike } from './auction-strike.entity';
export { Category } from './category.entity';
export { Clarification } from './clarification.entity';
export { ListingPhoto } from './listing-photo.entity';
export { Listing } from './listing.entity';
export { ScreeningTerm } from './screening-term.entity';
export { ListingStatusChange } from './listing-status-change.entity';

// Every table of the schemas listings, auctions, for TypeOrmModule.forFeature.
export const ENTITIES = [
  Auction,
  BidderAlias,
  BiddingRestriction,
  Bid,
  AuctionFlag,
  AuctionsOutboxEvent,
  SecondChanceOffer,
  AuctionStrike,
  Category,
  Clarification,
  ListingPhoto,
  Listing,
  ScreeningTerm,
  ListingStatusChange,
];
