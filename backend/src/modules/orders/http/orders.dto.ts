import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
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

/** FR-PAY-09: the buyer's request, or the seller's own cancellation, with its reason. */
export class CancellationDto {
  @IsString()
  @MaxLength(500)
  @Matches(/\S/, { message: 'reason must not be empty' })
  reason!: string;
}

export class CancellationDecisionDto {
  @IsIn(['accept', 'decline'])
  decision!: 'accept' | 'decline';
}

/** FR-PAY-17: a wallet (on the verified number) or a bank account; fields by kind. */
export class PayoutAccountDto {
  @IsIn(['bkash_wallet', 'nagad_wallet', 'bank'])
  kind!: 'bkash_wallet' | 'nagad_wallet' | 'bank';

  @ValidateIf((o: PayoutAccountDto) => o.kind !== 'bank')
  @IsString()
  @MaxLength(20)
  walletNumber?: string;

  @ValidateIf((o: PayoutAccountDto) => o.kind === 'bank')
  @IsString()
  @Matches(/\S/)
  @MaxLength(80)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  branchName?: string;

  @ValidateIf((o: PayoutAccountDto) => o.kind === 'bank')
  @Matches(/^[0-9]{9}$/)
  routingNumber?: string;

  @ValidateIf((o: PayoutAccountDto) => o.kind === 'bank')
  @IsString()
  @Matches(/\S/)
  @MaxLength(120)
  accountName?: string;

  @ValidateIf((o: PayoutAccountDto) => o.kind === 'bank')
  @Matches(/^[0-9]{6,20}$/)
  accountNumber?: string;
}

export class PayoutsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

/** A staff action's recorded reason (section 7.5). */
export class StaffReasonDto {
  @IsString()
  @Matches(/\S/)
  @MaxLength(500)
  reason!: string;
}

export class BankAccountDecisionDto extends StaffReasonDto {
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';
}
