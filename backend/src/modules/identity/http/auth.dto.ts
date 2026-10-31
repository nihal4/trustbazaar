import { IsBoolean, IsEmail, IsString, IsUUID, Length, Matches, MaxLength, MinLength } from 'class-validator';

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
