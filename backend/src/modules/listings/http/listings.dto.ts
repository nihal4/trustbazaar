import { Type } from 'class-transformer';
import {
  IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { FULFILMENT_OPTIONS, ITEM_CONDITION, ITEM_KIND, SALE_FORMAT, SIZE_CLASS, STATUS, WEIGHT_CLASS } from '../db/enums';
import type { Fulfilment, ItemCondition, ItemKind, ListingStatus, SaleFormat, SizeClass, WeightClass } from '../ports';

// The request bodies of the listings API (docs/design/03_listings_auctions.pdf section 3.1). Money is
// integer poisha as a decimal string, never a number (BUILDING.md section 4). Text is plain text; the
// service trims it, and the database checks the minimum lengths again.
export const POISHA = /^[1-9][0-9]{0,15}$/;

/** FR-LST-06: the area shown (district) and the location used for distance, rounded to 3 decimals (about 110 m). */
export class AreaDto {
  @IsString()
  @Length(2, 40)
  district!: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(20)
  @Max(27)
  lat!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(88)
  @Max(93)
  lng!: number;
}

/** The item details shared by a new draft and an edit (FR-LST-01 to FR-LST-07). */
class ItemDetailsDto {
  @IsOptional()
  @IsIn(ITEM_CONDITION)
  condition?: ItemCondition;

  /** FR-LST-02: the declaration that there are no visible defects (otherwise a photo must show them). */
  @IsOptional()
  @IsBoolean()
  noVisibleDefects?: boolean;

  @IsOptional()
  @IsIn(FULFILMENT_OPTIONS)
  fulfilmentOptions?: Fulfilment;

  /** FR-LST-03: needed for courier; null clears it (pickup only). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(WEIGHT_CLASS)
  weightClass?: WeightClass | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(SIZE_CLASS)
  sizeClass?: SizeClass | null;

  /** Fixed price only, in poisha. */
  @IsOptional()
  @IsString()
  @Matches(POISHA, { message: 'price must be a whole number of poisha' })
  price?: string;

  /** Fixed price only; auctions and game accounts have one unit. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9999)
  quantity?: number;

  /** Defaults to the seller's saved area (I-24). */
  @IsOptional()
  @ValidateNested()
  @Type(() => AreaDto)
  area?: AreaDto;
}

/** A new draft (FR-LST-01). Item kind and sale format are chosen here, and fixed at publication. */
export class CreateListingDto extends ItemDetailsDto {
  @IsIn(ITEM_KIND)
  itemKind!: ItemKind;

  @IsIn(SALE_FORMAT)
  saleFormat!: SaleFormat;

  @IsInt()
  @Min(1)
  categoryId!: number;

  @IsString()
  @Length(5, 120)
  title!: string;

  @IsString()
  @Length(20, 5000)
  description!: string;
}

/** An edit (FR-LST-07): only the fields sent change. */
export class UpdateListingDto extends ItemDetailsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  categoryId?: number;

  @IsOptional()
  @IsString()
  @Length(5, 120)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(20, 5000)
  description?: string;
}

/**
 * Publishing (FR-LST-12). An auction's terms are given here and fixed from then on (FR-LST-07): start price,
 * optional reserve, and one of the CP-07 durations. A fixed-price listing sends an empty body.
 */
export class PublishListingDto {
  @IsOptional()
  @IsString()
  @Matches(POISHA, { message: 'startPrice must be a whole number of poisha' })
  startPrice?: string;

  @IsOptional()
  @IsString()
  @Matches(POISHA, { message: 'reservePrice must be a whole number of poisha' })
  reservePrice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  duration?: string;
}

export class ClarificationDto {
  @IsString()
  @Length(1, 1000)
  body!: string;
}

export class MyListingsQuery {
  @IsOptional()
  @IsIn(STATUS)
  status?: ListingStatus;

  /** The nextCursor of the previous page. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  cursor?: string;
}

export class PhotoUploadDto {
  /** Multipart text field: "true" when this photo shows the item's defects (FR-LST-02). */
  @IsOptional()
  @IsIn(['true', 'false'])
  showsDefects?: 'true' | 'false';
}

export class PhotoQuery {
  @IsOptional()
  @IsIn(['full', 'thumb'])
  size?: 'full' | 'thumb';
}
