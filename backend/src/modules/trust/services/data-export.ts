import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { collectRows, DataExportSource } from '../../../kernel/privacy/data-export';

// Unit 7's part of the data export (FR-PRV-03; U7-11): the user's disputes (with the statements the user made), the
// reports the user filed, ratings given and received, sanctions, strikes and the public trust summary. Staff ids,
// internal notes on reports and fraud signals are left out; evidence files are not included.
const Q = {
  disputes: `SELECT to_jsonb(d) - '{assigned_to,decided_by,approval_id}'::text[] AS r FROM disputes.disputes d WHERE buyer_id = $1 OR seller_id = $1 ORDER BY opened_at, id`,
  disputeStatements: `SELECT jsonb_build_object('disputeId', s.dispute_id, 'party', s.party, 'text', s.text, 'at', s.at) AS r
                        FROM disputes.statements s JOIN disputes.disputes d ON d.id = s.dispute_id
                       WHERE s.purged_at IS NULL AND ((s.party = 'buyer' AND d.buyer_id = $1) OR (s.party = 'seller' AND d.seller_id = $1)) ORDER BY s.at, s.id`,
  reportsFiled: `SELECT to_jsonb(r) - '{reporter_id,assigned_to,resolved_by}'::text[] AS r FROM trust.reports r WHERE reporter_id = $1 ORDER BY created_at, id`,
  ratingsGiven: `SELECT to_jsonb(g) - '{rater_id,removed_by}'::text[] AS r FROM trust.ratings g WHERE rater_id = $1 ORDER BY created_at, id`,
  ratingsReceived: `SELECT to_jsonb(g) - '{ratee_id,removed_by}'::text[] AS r FROM trust.ratings g WHERE ratee_id = $1 ORDER BY created_at, id`,
  sanctions: `SELECT to_jsonb(s) - '{user_id,created_by,lifted_by,lift_approval_id}'::text[] AS r FROM trust.sanctions s WHERE user_id = $1 ORDER BY starts_at, id`,
  strikes: `SELECT to_jsonb(s) - 'user_id' AS r FROM trust.strikes s WHERE user_id = $1 ORDER BY at, id`,
  trustSummary: `SELECT to_jsonb(p) - 'user_id' AS r FROM trust.profile_summary p WHERE user_id = $1`,
};

@Injectable()
export class TrustDataExport implements DataExportSource {
  readonly section = 'trust';
  constructor(private readonly db: DataSource) {}
  exportFor(userId: string) {
    return collectRows(this.db, Q, userId);
  }
}
