import { IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

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
