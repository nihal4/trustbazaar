import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

// Chat requests (docs/design/06_chat_notifications.pdf section 3.1; U6-02). Lengths are checked again by the
// service after normalisation and by the database (DV-40).

export class ThreadsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

export class MessagesQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  after?: number;
}

/** FR-CHT-02: the client's message id makes a resend safe. */
export class PostTextDto {
  @IsUUID()
  clientId!: string;

  @IsString()
  @MaxLength(4000) // DV-40 is applied after NFC normalisation
  text!: string;
}

/** Multipart: the image in the part "image", and the fields "clientId" and an optional "caption". */
export class PostImageDto {
  @IsUUID()
  clientId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  caption?: string;
}

/** FR-CHT-05 */
export class MarksDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  delivered!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  read!: number;
}

/** FR-CHT-06: the thread, or one message by its sequence number; the category of FR-TNS-01. */
export class ReportDto {
  @IsIn(['fraudulent', 'counterfeit', 'prohibited', 'misrepresented', 'abusive'])
  category!: 'fraudulent' | 'counterfeit' | 'prohibited' | 'misrepresented' | 'abusive';

  @IsOptional()
  @IsInt()
  @Min(1)
  messageSeq?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000) // 2000 after normalisation, checked by the service
  text?: string;
}

/** Staff: a detection term and its flag (FR-CHT-07). */
export class DetectionTermDto {
  @IsString()
  @MaxLength(200)
  term!: string;

  @IsIn(['payment_phrase', 'off_platform_app', 'credentials'])
  flag!: 'payment_phrase' | 'off_platform_app' | 'credentials';
}

export class DetectionTermQuery {
  @IsString()
  @MaxLength(200)
  term!: string;
}
