import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import { IDENTITY_CRYPTO, IdentityCryptoPort } from '../../identity/ports';

// AddressVault for saved addresses (docs/design/04_delivery.pdf section 7.1; FR-DLV-07; SRS section 7: Confidential;
// U4-02). Only the label and the area are in clear. The street lines, landmark and contact name are one JSON value,
// encrypted by Unit 1's IdentityCrypto (AES-256-GCM) with the table, column and row id as associated data, so a
// ciphertext copied to another row does not decrypt. A user sees and changes only their own; deleting erases it.

export type AddressKind = 'pickup' | 'dropoff';
export interface AddressLines { line1: string; line2?: string; landmark?: string; contactName: string }
export interface AddressView extends AddressLines {
  id: string;
  kind: AddressKind;
  label: string;
  area: { id: number; district: string; nameEn: string; nameBn: string };
  createdAt: string;
}

export const contextOf = (id: string) => `delivery.saved_addresses.address_enc:${id}`;
const LIMITS = { label: 40, line: 120, landmark: 120, contactName: 80 };

@Injectable()
export class AddressService {
  constructor(
    private readonly db: DataSource,
    @Inject(IDENTITY_CRYPTO) private readonly crypto: IdentityCryptoPort,
  ) {}

  /** GET /me/addresses: the caller's own, newest first, decrypted for them only. */
  async list(userId: string): Promise<{ items: AddressView[] }> {
    const rows = (await this.db.query(
      `SELECT s.id, s.kind, s.label, s.address_enc, s.created_at, a.id AS area_id, a.district, a.name_en, a.name_bn
         FROM delivery.saved_addresses s JOIN delivery.areas a ON a.id = s.area_id
        WHERE s.user_id = $1 AND s.deleted_at IS NULL ORDER BY s.created_at DESC, s.id`,
      [userId],
    )) as { id: string; kind: AddressKind; label: string; address_enc: Buffer; created_at: Date; area_id: number; district: string; name_en: string; name_bn: string }[];
    const items = await Promise.all(rows.map(async (r) => {
      const lines = JSON.parse(await this.crypto.decrypt(r.address_enc, contextOf(r.id))) as AddressLines;
      return {
        id: r.id, kind: r.kind, label: r.label, ...lines,
        area: { id: r.area_id, district: r.district, nameEn: r.name_en, nameBn: r.name_bn }, createdAt: r.created_at.toISOString(),
      };
    }));
    return { items };
  }

  /** POST /me/addresses */
  async create(userId: string, a: { kind: AddressKind; label: string; areaId: number } & AddressLines): Promise<AddressView> {
    const clean = (v: string | undefined) => v?.normalize('NFC').trim().replace(/\s+/g, ' ') || undefined;
    const label = clean(a.label);
    const lines: AddressLines = { line1: clean(a.line1) ?? '', contactName: clean(a.contactName) ?? '' };
    const line2 = clean(a.line2);
    const landmark = clean(a.landmark);
    if (line2) lines.line2 = line2;
    if (landmark) lines.landmark = landmark;
    const errors: { field: string; reason: string }[] = [];
    if (!label) errors.push({ field: 'label', reason: 'required' });
    else if (label.length > LIMITS.label) errors.push({ field: 'label', reason: 'too-long' });
    if (!lines.line1) errors.push({ field: 'line1', reason: 'required' });
    if (!lines.contactName) errors.push({ field: 'contactName', reason: 'required' });
    for (const [k, max] of [['line1', LIMITS.line], ['line2', LIMITS.line], ['landmark', LIMITS.landmark], ['contactName', LIMITS.contactName]] as const) {
      if ((lines[k]?.length ?? 0) > max) errors.push({ field: k, reason: 'too-long' });
    }
    if (errors.length) throw new Problem('validation-failed', { errors });
    const [area] = (await this.db.query(`SELECT id, district, name_en, name_bn FROM delivery.areas WHERE id = $1 AND active`, [a.areaId])) as {
      id: number; district: string; name_en: string; name_bn: string;
    }[];
    if (!area) throw new Problem('validation-failed', { errors: [{ field: 'areaId', reason: 'unknown' }] });

    const id = randomUUID();
    const sealed = await this.crypto.encrypt(JSON.stringify(lines), contextOf(id));
    const [r] = (await this.db.query(
      `INSERT INTO delivery.saved_addresses (id, user_id, kind, label, area_id, address_enc) VALUES ($1, $2, $3, $4, $5, $6) RETURNING created_at`,
      [id, userId, a.kind, label, area.id, Buffer.from(sealed)],
    )) as { created_at: Date }[];
    return {
      id, kind: a.kind, label: label!, ...lines,
      area: { id: area.id, district: area.district, nameEn: area.name_en, nameBn: area.name_bn }, createdAt: r.created_at.toISOString(),
    };
  }

  /** DELETE /me/addresses/{id}: the ciphertext is erased (saved_address_erased); quotes keep their area. */
  async remove(userId: string, id: string): Promise<void> {
    const res = (await this.db.query(
      `UPDATE delivery.saved_addresses SET deleted_at = now(), address_enc = NULL WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING id`, [id, userId],
    )) as unknown[];
    const rows = (Array.isArray(res[0]) ? res[0] : res) as unknown[];
    if (rows.length === 0) throw new Problem('not-found');
  }
}
