import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ITEM_CONDITION, ITEM_KIND, SALE_FORMAT } from '../db/enums';
import type { ItemCondition, ItemKind, SaleFormat } from '../ports';
import { POISHA } from './listings.dto';

/** FR-SRC-03, and relevance when there are words (Decisions log, U3-03). */
export const SORTS = ['relevance', 'newest', 'price_asc', 'price_desc', 'distance', 'ending_soon'] as const;
export type Sort = (typeof SORTS)[number];

/** GET /search (docs/design/03_listings_auctions.pdf section 7): every field optional; filters in the page's URL. */
export class SearchQuery {
  /** FR-SRC-01: words in Bangla or English, matched in the title and description. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  q?: string;

  /** FR-SRC-02: a category and its sub-categories. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(32767)
  category?: number;

  @IsOptional()
  @IsIn(ITEM_KIND)
  itemKind?: ItemKind;

  @IsOptional()
  @IsIn(SALE_FORMAT)
  saleFormat?: SaleFormat;

  @IsOptional()
  @IsIn(ITEM_CONDITION)
  condition?: ItemCondition;

  /** Poisha; an auction counts at its current price (or its start price before the first bid). */
  @IsOptional()
  @IsString()
  @Matches(POISHA, { message: 'minPrice must be a whole number of poisha' })
  minPrice?: string;

  @IsOptional()
  @IsString()
  @Matches(POISHA, { message: 'maxPrice must be a whole number of poisha' })
  maxPrice?: string;

  /** Kilometres from the search point (FR-SRC-02). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  maxKm?: number;

  /** The search point ("Use my location" or the chosen area), within Bangladesh; rounded to 3 decimals by the server. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(20)
  @Max(27)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(88)
  @Max(93)
  lng?: number;

  @IsOptional()
  @IsIn(SORTS)
  sort?: Sort;

  /** The nextCursor of the previous page. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}
