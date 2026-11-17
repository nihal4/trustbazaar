import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AccountLink, AccountLinkSource } from '../../../kernel/links/account-links';

// FR-TNS-08 (U7-09): accounts that signed in from the same browser. A browser keeps one device key for every account
// signed in on it (SessionService.create), so two accounts with the same key hash used the same browser.
@Injectable()
export class DeviceLinks implements AccountLinkSource {
  constructor(private readonly db: DataSource) {}

  async pairs(): Promise<AccountLink[]> {
    const rows = (await this.db.query(
      `SELECT b.user_id, a.user_id AS linked_to, min(b.first_seen_at) AS at
         FROM identity.known_devices a
         JOIN identity.known_devices b ON b.device_key_hash = a.device_key_hash AND b.user_id <> a.user_id
                                      AND (a.first_seen_at, a.user_id) < (b.first_seen_at, b.user_id)
        GROUP BY b.user_id, a.user_id ORDER BY 3, 1, 2`,
    )) as { user_id: string; linked_to: string; at: Date }[];
    return rows.map((r) => ({ via: 'device', userId: r.user_id, linkedTo: r.linked_to, at: r.at }));
  }

  async linkedTo(userId: string, others: string[]): Promise<{ userId: string; via: 'device' }[]> {
    if (others.length === 0) return [];
    const rows = (await this.db.query(
      `SELECT DISTINCT o.user_id FROM identity.known_devices u
         JOIN identity.known_devices o ON o.device_key_hash = u.device_key_hash
        WHERE u.user_id = $1 AND o.user_id = ANY($2::uuid[]) AND o.user_id <> $1 ORDER BY 1`,
      [userId, others],
    )) as { user_id: string }[];
    return rows.map((r) => ({ userId: r.user_id, via: 'device' }));
  }
}
