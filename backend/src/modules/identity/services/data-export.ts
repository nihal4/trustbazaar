import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { collectRows, DataExportSource } from '../../../kernel/privacy/data-export';

// Unit 1's part of the data export (FR-PRV-03; U7-11): the profile, consents, sessions, devices and the KYC
// submissions' outcome. Password hashes, device and document hashes, encrypted document details and staff ids are
// left out; KYC images are never included (the export tells the user to ask the operator).
const Q = {
  profile: `SELECT to_jsonb(u) - '{password_hash,password_single_factor_ok}'::text[] AS r FROM identity.users u WHERE id = $1`,
  consents: `SELECT to_jsonb(c) - 'user_id' AS r FROM identity.consents c WHERE user_id = $1 ORDER BY recorded_at, id`,
  sessions: `SELECT to_jsonb(s) - '{user_id,staff_id,principal_type}'::text[] AS r FROM identity.sessions s WHERE user_id = $1 ORDER BY created_at, id`,
  devices: `SELECT to_jsonb(d) - '{user_id,device_key_hash}'::text[] AS r FROM identity.known_devices d WHERE user_id = $1 ORDER BY first_seen_at, id`,
  kycSubmissions: `SELECT jsonb_build_object('id', id, 'documentType', doc_type, 'status', status, 'submittedAt', submitted_at, 'decidedAt', decided_at,
                          'rejectionReason', rejection_reason, 'erasedAt', erased_at) AS r
                     FROM identity.kyc_submissions WHERE user_id = $1 ORDER BY submitted_at, id`,
  kycStatusHistory: `SELECT jsonb_build_object('from', from_status, 'to', to_status, 'by', actor_type, 'reason', reason, 'at', at) AS r
                       FROM identity.kyc_status_history WHERE user_id = $1 ORDER BY at, id`,
};

@Injectable()
export class IdentityDataExport implements DataExportSource {
  readonly section = 'account';
  constructor(private readonly db: DataSource) {}
  exportFor(userId: string) {
    return collectRows(this.db, Q, userId);
  }
}
