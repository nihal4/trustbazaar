import { IsString, Matches } from 'class-validator';
import { POISHA } from './listings.dto';

/** Section 3.2: a bid is { maximum } in poisha; a plain bid is a maximum equal to the amount. */
export class PlaceBidDto {
  @IsString()
  @Matches(POISHA, { message: 'maximum must be a whole number of poisha' })
  maximum!: string;
}
