import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';
import { decryptField, encryptField, FieldContext } from './field-crypto';

// IdentityCrypto (Unit 1 section 5.5; Unit 9 section 4 ports; SEC-DAT-03). Field encryption under
// FIELD_KEY_V{n} with the table, column and row as associated data, for this unit; encrypt/decrypt with a
// free-form context, for other units (Unit 4 addresses). Blind indexes are HMAC-SHA-256 under BIDX_KEY:
// the document index over the type and the number reduced to its digits and letters; the person index
// over the normalised full name and the date of birth (a second, non-blocking signal).
export type DocType = 'nid' | 'passport';

/** "Md.  Rahim   Uddin" -> "md rahim uddin": lower case, letters and digits, single spaces. */
export function normaliseName(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The document number as compared: NID digits only; passport letters and digits, upper case. */
export function normaliseDocNumber(type: DocType, number: string): string {
  return type === 'nid' ? number.replace(/\D/g, '') : number.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

@Injectable()
export class IdentityCrypto {
  constructor(@Inject(TB_CONFIG) private readonly config: TbConfig) {}

  get fieldKeyVersion(): number {
    return this.config.keys.field.current;
  }

  sealField(plain: string, ctx: FieldContext): Buffer {
    return encryptField(this.config.keys.field, Buffer.from(plain, 'utf8'), ctx);
  }

  openField(blob: Buffer, ctx: FieldContext): string {
    return decryptField(this.config.keys.field, blob, ctx).toString('utf8');
  }

  /** The port for other units: the context is the associated data (for example "delivery.addresses|line1|<id>"). */
  async encrypt(plain: string, context: string): Promise<Uint8Array> {
    return this.sealField(plain, { table: 'external', column: context, rowId: '' });
  }

  async decrypt(sealed: Uint8Array, context: string): Promise<string> {
    return this.openField(Buffer.from(sealed), { table: 'external', column: context, rowId: '' });
  }

  docNumberIndex(type: DocType, number: string): Buffer {
    return this.hmac(`doc|${type}|${normaliseDocNumber(type, number)}`);
  }

  personIndex(fullName: string, dateOfBirth: string): Buffer {
    return this.hmac(`person|${normaliseName(fullName)}|${dateOfBirth}`);
  }

  private hmac(text: string): Buffer {
    return createHmac('sha256', this.config.secrets.bidxKey.reveal()).update(text, 'utf8').digest();
  }
}
