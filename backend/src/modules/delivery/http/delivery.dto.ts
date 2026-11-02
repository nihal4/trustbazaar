import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

// Unit 4 requests (docs/design/04_delivery.pdf section 3.1; U4-02). Money in poisha, as strings of digits.

export class FulfilmentOptionsQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  areaId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9999)
  quantity?: number;
}

export class QuoteDto {
  @IsUUID('4')
  listingId!: string;

  @IsInt()
  @Min(1)
  @Max(9999)
  quantity!: number;

  @IsUUID('4')
  addressId!: string;
}

export class AddressDto {
  @IsIn(['pickup', 'dropoff'])
  kind!: 'pickup' | 'dropoff';

  @IsString()
  @MaxLength(200)
  label!: string;

  @IsInt()
  @Min(1)
  areaId!: number;

  @IsString()
  @MaxLength(400)
  line1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  line2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  landmark?: string;

  @IsString()
  @MaxLength(300)
  contactName!: string;
}

const ZONES = ['inside_dhaka', 'dhaka_suburbs', 'outside_dhaka'] as const;

export class AreaDto {
  @IsString()
  @MaxLength(40)
  district!: string;

  @IsString()
  @MaxLength(80)
  nameEn!: string;

  @IsString()
  @MaxLength(80)
  nameBn!: string;

  @IsIn(ZONES)
  zone!: (typeof ZONES)[number];

  @IsNumber()
  lat!: number;

  @IsNumber()
  lng!: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class AreaPatchDto {
  @IsOptional() @IsString() @MaxLength(80) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(80) nameBn?: string;
  @IsOptional() @IsIn(ZONES) zone?: (typeof ZONES)[number];
  @IsOptional() @IsNumber() lat?: number;
  @IsOptional() @IsNumber() lng?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

const POISHA = /^[1-9]\d{0,9}$/;

export class FareRowDto {
  @IsIn(ZONES)
  zone!: (typeof ZONES)[number];

  @Matches(POISHA)
  upTo1kg!: string;

  @Matches(POISHA)
  upTo2kg!: string;

  @Matches(/^(0|[1-9]\d{0,9})$/)
  perExtraKg!: string;
}

export class FareTableDto {
  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;

  @IsString()
  @MaxLength(500)
  source!: string;

  @ValidateNested({ each: true })
  @Type(() => FareRowDto)
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  rows!: FareRowDto[];
}
