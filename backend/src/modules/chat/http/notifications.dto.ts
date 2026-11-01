import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

export class NotificationsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

/** Either some notices by id (up to 100) or all of them. */
export class MarkReadDto {
  @ValidateIf((o: MarkReadDto) => o.all !== true)
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ids?: string[];

  @IsOptional()
  @IsIn([true])
  all?: true;
}

/** FR-NTF-05: the language of notices; transactional e-mails on or off (security notices are always sent). */
export class PreferencesDto {
  @IsOptional()
  @IsIn(['bn', 'en'])
  language?: 'bn' | 'en';

  @IsOptional()
  @IsBoolean()
  emailTransactional?: boolean;
}
