import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { collectRows, DataExportSource } from '../../../kernel/privacy/data-export';

// Unit 5's part of the data export (FR-PRV-03; U7-11): game-account listing details, ownership proofs (without the
// screenshot), handovers as buyer or seller and the user's own credential views. Never a credential: the sealed
// credentials and buyer keys are not read at all.
const Q = {
  listings: `SELECT to_jsonb(d) - 'seller_id' AS r FROM game_accounts.details d WHERE seller_id = $1 ORDER BY created_at`,
  ownershipProofs: `SELECT to_jsonb(p) - '{code,screenshot_key,screenshot_dek,screenshot_sha256,reviewed_by}'::text[] AS r
                      FROM game_accounts.ownership_proofs p JOIN game_accounts.details d ON d.listing_id = p.listing_id WHERE d.seller_id = $1 ORDER BY p.issued_at, p.id`,
  handovers: `SELECT to_jsonb(h) AS r FROM game_accounts.handovers h WHERE buyer_id = $1 OR seller_id = $1 ORDER BY order_id`,
  credentialViews: `SELECT to_jsonb(a) - '{user_id,session_id}'::text[] AS r FROM game_accounts.access_log a WHERE user_id = $1 ORDER BY at, id`,
};

@Injectable()
export class GameAccountsDataExport implements DataExportSource {
  readonly section = 'gameAccounts';
  constructor(private readonly db: DataSource) {}
  exportFor(userId: string) {
    return collectRows(this.db, Q, userId);
  }
}
