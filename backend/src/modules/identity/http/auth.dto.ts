import { IsBoolean, IsEmail, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { STEP_UP_ACTIONS, StepUpAction } from '../../../kernel/http/policies';

export class SignInDto {
  /** A Bangladeshi mobile number (01XXXXXXXXX or +8801XXXXXXXXX) or an e-mail address. */
  @IsString()
  @MaxLength(254)
  login!: string;

  /** DV-8: at most 256 characters, which bounds the Argon2id work. */
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}

export class MfaDto {
  /** A 6-digit TOTP code, or a recovery code. */
  @IsString()
  @Length(6, 40)
  @Matches(/^[0-9A-Za-z -]+$/)
  code!: string;
}

/** FR-ACC-01, FR-ACC-04: registration details. The password policy itself is checked by the service. */
export class RegisterDto {
  /** A Bangladeshi mobile number, 01XXXXXXXXX or +8801XXXXXXXXX. */
  @IsString()
  @MaxLength(20)
  phone!: string;

  @IsEmail({}, { message: 'email must be an e-mail address' })
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(2, 40)
  @Matches(/\S.*\S/)
  displayName!: string;

  /** SEC-AUTH-01: every printable character is accepted; the service checks the length and the blocklist. */
  @IsString()
  @MaxLength(1024)
  password!: string;

  @IsString()
  @Length(1, 20)
  termsVersion!: string;

  @IsString()
  @Length(1, 20)
  privacyVersion!: string;

  @IsBoolean()
  adultConfirmed!: boolean;
}

export class RegistrationIdDto {
  @IsUUID()
  registrationId!: string;
}

export class RegisterVerifyDto extends RegistrationIdDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class EmailVerifyDto {
  /** The 256-bit token from the e-mailed link (base64url). */
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;
}

export class StepUpStartDto {
  @IsIn(STEP_UP_ACTIONS)
  action!: StepUpAction;
}

export class StepUpVerifyDto extends StepUpStartDto {
  /** An SMS code, a TOTP code or a recovery code. */
  @IsString()
  @Length(6, 40)
  @Matches(/^[0-9A-Za-z -]+$/)
  code!: string;
}

export class PasswordForgotDto {
  /** A mobile number or an e-mail address. */
  @IsString()
  @MaxLength(254)
  login!: string;
}

/** SEC-AUTH-10: the link token, or the number and the SMS code; with MFA on, also mfaCode. */
export class PasswordResetDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token?: string;

  @ValidateIf((o: PasswordResetDto) => o.token === undefined)
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ValidateIf((o: PasswordResetDto) => o.token === undefined)
  @IsString()
  @Matches(/^\d{6}$/)
  code?: string;

  @IsString()
  @MaxLength(1024)
  newPassword!: string;

  @IsOptional()
  @IsString()
  @Length(6, 40)
  @Matches(/^[0-9A-Za-z -]+$/)
  mfaCode?: string;
}

export class PasswordChangeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  currentPassword!: string;

  @IsString()
  @MaxLength(1024)
  newPassword!: string;
}

export class PhoneChangeDto {
  @IsString()
  @MaxLength(20)
  phone!: string;
}

export class CodeDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class EmailChangeDto {
  @IsEmail({}, { message: 'email must be an e-mail address' })
  @MaxLength(254)
  email!: string;
}

export class StaffSignInDto {
  @IsEmail({}, { message: 'email must be an e-mail address' })
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}

export class StaffEnrolDto {
  @IsString()
  @MaxLength(1024)
  newPassword!: string;
}

export class NewStaffDto {
  @IsEmail({}, { message: 'email must be an e-mail address' })
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(2, 60)
  displayName!: string;

  @IsIn(['operator', 'administrator'])
  role!: 'operator' | 'administrator';

  /** FR-OPS-06: compared with users' numbers for conflicts of interest. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;
}

export class ReasonDto {
  @IsString()
  @Length(10, 1000)
  reason!: string;
}

export class DecisionDto {
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ConflictDto extends ReasonDto {
  @IsUUID()
  userId!: string;
}

export class AuditQueryDto {
  @IsOptional() @IsUUID() actorId?: string;
  @IsOptional() @IsUUID() objectId?: string;
  @IsOptional() @IsString() @Matches(/^[a-z_.]{1,80}$/) action?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @Matches(/^\d{1,18}$/) before?: string;
  @IsOptional() @Matches(/^\d{1,3}$/) limit?: string;
}
