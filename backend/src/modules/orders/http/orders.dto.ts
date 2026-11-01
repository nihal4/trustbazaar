import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { FULFILMENT } from '../db/enums';
import type { Fulfilment } from '../ports';

// Request bodies of the orders API (docs/design/02_orders_payments.pdf section 3.1). No amount is ever
// accepted from the client (SEC-PAY-06): prices come from the listing and the parameter version.

/** FR-FIX-01: fixed-price checkout. The fulfilment method may also be chosen afterwards. */
export class CheckoutDto {
  @IsUUID('4')
  listingId!: string;

  @IsInt()
  @Min(1)
  @Max(9999)
  quantity!: number;

  @IsOptional()
  @IsIn(FULFILMENT)
  fulfilment?: Fulfilment;
}

/** FR-DLV-02: the method before payment (a delivery quote joins it when Unit 4 issues them, I-21). */
export class FulfilmentDto {
  @IsIn(FULFILMENT)
  fulfilment!: Fulfilment;
}

export class OrdersQuery {
  @IsOptional()
  @IsIn(['buyer', 'seller'])
  role?: 'buyer' | 'seller';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  cursor?: string;
}

/** FR-PAY-01: which provider's page to pay on. */
export class StartPaymentDto {
  @IsIn(['bkash', 'nagad', 'stripe'])
  provider!: 'bkash' | 'nagad' | 'stripe';
}

/** The mock provider's page: the outcome the buyer chose (form field). */
export class MockPayDto {
  @IsIn(['succeeded', 'failed'])
  outcome!: 'succeeded' | 'failed';
}
