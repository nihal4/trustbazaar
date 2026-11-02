import { QueryFailedError } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';

// The database's refusals of delivery.make_quote and delivery.claim_quote (docs/design/sql/04_delivery.sql) as the
// stable codes of section 3.1, answered 422 delivery-refused with the code as errors[0].reason.
const CODES: [RegExp, string, string][] = [
  [/does not offer courier/, 'fulfilment', 'courier_not_offered'],
  [/too heavy or too large/, 'quantity', 'parcel_too_large'],
  [/does not match this order/, 'quoteId', 'quote_mismatch'],
  [/already used/, 'quoteId', 'quote_used'],
  [/quote_one_per_order/, 'quoteId', 'quote_used'], // a second checkout quote for the same order
  [/quote expired/, 'quoteId', 'quote_expired'],
  [/unknown drop-off area/, 'areaId', 'unknown_area'],
  [/drop-off address must be/, 'addressId', 'address_not_yours'],
  [/no fare table in force/, 'fare', 'no_fare_table'],
  // meetups and the handover code (U4-03)
  [/meetup time must be between/, 'meetAt', 'meetup_time_out_of_range'],
  [/proposal is no longer open/, 'proposalId', 'proposal_closed'],
  [/cannot be arranged now|handover is closed/, 'handover', 'handover_closed'],
  [/code entry is locked/, 'code', 'code_locked'],
  [/deadline has passed/, 'code', 'deadline_passed'],
  [/not an active meetup point/, 'pointId', 'point_not_active'],
  [/suggested point or a place|proposal_one_place|proposal_own_place|proposal_pin/, 'placeName', 'place_invalid'],
];

export function refusal(field: string, code: string): Problem {
  return new Problem('delivery-refused', { errors: [{ field, reason: code }] });
}

export function fromDeliveryDb(err: unknown): never {
  if (err instanceof QueryFailedError) {
    const message = (err.driverError as { message?: string }).message ?? '';
    for (const [re, field, code] of CODES) if (re.test(message)) throw refusal(field, code);
  }
  throw err;
}
