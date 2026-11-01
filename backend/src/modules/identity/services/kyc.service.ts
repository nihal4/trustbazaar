import { Inject, Injectable } from '@nestjs/common';
import { randomInt, randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { DataSource, EntityManager } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import { REDIS } from '../../../kernel/redis.provider';
import { FileVault } from '../crypto/file-vault';
import { DocType, IdentityCrypto } from '../crypto/identity-crypto';
import { ImageRejected, reencodeImage } from '../crypto/images';
import { AuditService } from './audit.service';
import { publish } from './outbox';
import { RequestContext } from './session.service';

// KYC submission by the user (Unit 1 section 6.6; FR-KYC-01 to FR-KYC-05, FR-KYC-09, FR-KYC-12).
// 1. A liveness challenge: one random action for the second selfie frame, valid DV-3, used once (FR-KYC-02).
// 2. The submission: the document type, number, full name and date of birth as printed, and the images.
//    Each image is identified from its content, re-encoded without metadata, and sealed in the vault.
//    The fields are encrypted; blind indexes and routing flags are computed (flags only route a submission
//    for closer review, they never decide it). One transaction then records the submission and its files,
//    moves kyc_status to pending_review, writes the history row, the audit entry and identity.kyc.submitted.
export const CP34_WINDOW_DAYS = 30;
export const LIVENESS_SECONDS = 10 * 60; // DV-3
export const LIVENESS_ACTIONS = ['turn_head_left', 'turn_head_right', 'look_up', 'smile', 'blink_twice'] as const;
export type KycFileKind = 'doc_front' | 'doc_back' | 'passport_photo_page' | 'selfie_neutral' | 'selfie_action';
export const FILES_FOR: Record<DocType, KycFileKind[]> = {
  nid: ['doc_front', 'doc_back', 'selfie_neutral', 'selfie_action'],
  passport: ['passport_photo_page', 'selfie_neutral', 'selfie_action'],
};

export interface KycInput {
  docType: DocType;
  docNumber: string;
  fullName: string;
  dateOfBirth: string; // YYYY-MM-DD
  challengeId: string;
}

/**
 * FR-KYC-06 with FR-TNS-06: the user sees the reason code and the operator's note, except for a blacklist
 * match, which is shown as 'other' with no note so that a person under a fraud investigation is not told
 * (Decisions log, 2026-11-01). Staff and the history keep the real reason.
 */
export function userFacing(reason: string, note: string | null): { reason: string; note: string | null } {
  return reason === 'blacklisted' ? { reason: 'other', note: null } : { reason, note };
}

export interface KycStatusView {
  status: 'unsubmitted' | 'pending_review' | 'verified' | 'rejected' | 'revoked';
  changedAt: Date;
  rejection: { reason: string; note: string | null } | null;
  submissionsLeft: number;
  expectedReviewHours: number;
}

/** Whole years between the date of birth and `on` (FR-KYC-03). */
export function ageOn(dateOfBirth: string, on: Date): number {
  const [y, m, d] = dateOfBirth.split('-').map(Number);
  let age = on.getUTCFullYear() - y;
  if (on.getUTCMonth() + 1 < m || (on.getUTCMonth() + 1 === m && on.getUTCDate() < d)) age--;
  return age;
}

/** NID: 10, 13 or 17 digits (smart card, old and birth-year forms). Passport: 1-2 letters and 7-8 digits. */
export function validDocNumber(type: DocType, number: string): boolean {
  const n = number.replace(/[\s-]/g, '');
  return type === 'nid' ? /^(\d{10}|\d{13}|\d{17})$/.test(n) : /^[A-Za-z]{1,2}\d{7,8}$/.test(n);
}

const livenessKey = (userId: string, id: string) => `kyc:liveness:${userId}:${id}`;

@Injectable()
export class KycService {
  constructor(
    private readonly db: DataSource,
    private readonly crypto: IdentityCrypto,
    private readonly vault: FileVault,
    private readonly audit: AuditService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
  ) {}

  /** FR-KYC-02: one random action for the second selfie frame. */
  async livenessChallenge(userId: string): Promise<{ challengeId: string; action: string; expiresAt: string }> {
    await this.assertMaySubmit(userId);
    const challengeId = randomUUID();
    const action = LIVENESS_ACTIONS[randomInt(LIVENESS_ACTIONS.length)];
    await this.redis.set(livenessKey(userId, challengeId), action, 'EX', LIVENESS_SECONDS);
    return { challengeId, action, expiresAt: new Date(this.clock.now().getTime() + LIVENESS_SECONDS * 1000).toISOString() };
  }

  async status(userId: string): Promise<KycStatusView> {
    const [u] = await this.db.query(`SELECT kyc_status, kyc_status_changed_at FROM identity.users WHERE id = $1`, [userId]);
    const [last] = await this.db.query(
      `SELECT status, rejection_reason, rejection_note FROM identity.kyc_submissions WHERE user_id = $1 ORDER BY submitted_at DESC LIMIT 1`,
      [userId],
    );
    return {
      status: u.kyc_status,
      changedAt: u.kyc_status_changed_at,
      rejection: u.kyc_status === 'rejected' && last?.status === 'rejected' ? userFacing(last.rejection_reason, last.rejection_note) : null,
      submissionsLeft: await this.submissionsLeft(userId),
      expectedReviewHours: (await this.params.current()).ms('CP-44') / 3_600_000,
    };
  }

  /** FR-KYC-01: the submission; images are given by kind. */
  async submit(userId: string, input: KycInput, images: Partial<Record<KycFileKind, Buffer>>, ctx: RequestContext): Promise<{ submissionId: string; status: 'pending_review'; expectedReviewHours: number }> {
    await this.assertMaySubmit(userId);
    const errors = this.validate(input, images);
    if (errors.length) throw new Problem('validation-failed', { errors });
    const action = await this.redis.getdel(livenessKey(userId, input.challengeId));
    if (!action) throw new Problem('validation-failed', { errors: [{ field: 'challengeId', reason: 'expired-or-used' }] });

    const now = this.clock.now();
    const docNumber = input.docNumber.replace(/[\s-]/g, '').toUpperCase();
    const fullName = input.fullName.trim().replace(/\s+/g, ' ');
    const isAdult = ageOn(input.dateOfBirth, now) >= 18;
    const docBidx = this.crypto.docNumberIndex(input.docType, docNumber);
    const personBidx = this.crypto.personIndex(fullName, input.dateOfBirth);

    // Images first: identified, re-encoded and sealed. If anything later fails, the sealed files are removed.
    const kinds = FILES_FOR[input.docType];
    const sealed: { id: string; kind: KycFileKind; storageKey: string; wrappedDek: Buffer; keyVersion: number; sha256: Buffer; size: number }[] = [];
    try {
      for (const kind of kinds) {
        let jpeg: Buffer;
        try {
          ({ jpeg } = await reencodeImage(images[kind]!));
        } catch (e) {
          if (e instanceof ImageRejected) throw new Problem('validation-failed', { errors: [{ field: kind, reason: e.reason }] });
          throw e;
        }
        const id = randomUUID();
        sealed.push({ id, kind, ...(await this.vault.seal('kyc', id, jpeg)) });
      }

      const flags = await this.flags(userId, docBidx, personBidx, isAdult);
      const submissionId = randomUUID();
      const field = (column: string, v: string) => this.crypto.sealField(v, { table: 'kyc_submissions', column, rowId: submissionId });
      await this.db.transaction(async (m) => {
        await m.query(
          `INSERT INTO identity.kyc_submissions (id, user_id, doc_type, doc_number_enc, doc_number_bidx, full_name_enc, dob_enc, person_bidx,
                                                 key_version, is_adult, liveness_action, routed_flags, submitted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [submissionId, userId, input.docType, field('doc_number_enc', docNumber), docBidx, field('full_name_enc', fullName),
           field('dob_enc', input.dateOfBirth), personBidx, this.crypto.fieldKeyVersion, isAdult, action, flags, now],
        );
        for (const f of sealed) {
          await m.query(
            `INSERT INTO identity.kyc_files (id, submission_id, kind, storage_key, wrapped_dek, key_version, sha256, mime, byte_size, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'image/jpeg', $8, $9)`,
            [f.id, submissionId, f.kind, f.storageKey, f.wrappedDek, f.keyVersion, f.sha256, f.size, now],
          );
        }
        await this.moveStatus(m, userId, 'pending_review', { actorType: 'user', actorId: userId, submissionId });
        await this.audit.record(m, {
          actorType: 'user', actorId: userId, action: 'identity.kyc.submitted', objectType: 'kyc_submission', objectId: submissionId,
          after: { docType: input.docType, flags }, sourceIp: ctx.ip, correlationId: ctx.correlationId,
        });
        await publish(m, 'identity.kyc.submitted', userId, { userId, submissionId, flags });
      });
      return { submissionId, status: 'pending_review', expectedReviewHours: (await this.params.current()).ms('CP-44') / 3_600_000 };
    } catch (e) {
      await Promise.all(sealed.map((f) => this.vault.erase('kyc', f.storageKey)));
      if ((e as { code?: string }).code === '23505') throw new Problem('kyc-not-allowed'); // a second open submission
      throw e;
    }
  }

  /** FR-KYC-05: every status change, with actor and reason, in the caller's transaction. */
  async moveStatus(
    m: EntityManager,
    userId: string,
    to: 'pending_review' | 'verified' | 'rejected' | 'revoked',
    by: { actorType: 'user' | 'staff'; actorId: string; submissionId?: string; approvalId?: string; reason?: string },
  ): Promise<void> {
    const [u] = await m.query(`SELECT kyc_status FROM identity.users WHERE id = $1 FOR UPDATE`, [userId]);
    await m.query(`UPDATE identity.users SET kyc_status = $2 WHERE id = $1`, [userId, to]); // the trigger checks the transition
    await m.query(
      `INSERT INTO identity.kyc_status_history (user_id, from_status, to_status, actor_type, actor_id, submission_id, approval_id, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, u.kyc_status, to, by.actorType, by.actorId, by.submissionId ?? null, by.approvalId ?? null, by.reason ?? null],
    );
  }

  /** Routing flags (FR-KYC-03, FR-KYC-04): they send a submission to closer review, never decide it. */
  private async flags(userId: string, docBidx: Buffer, personBidx: Buffer, isAdult: boolean): Promise<string[]> {
    const [r] = await this.db.query(
      `SELECT EXISTS (SELECT 1 FROM identity.identity_claims WHERE doc_number_bidx = $2 AND user_id <> $1)
           OR EXISTS (SELECT 1 FROM identity.kyc_submissions WHERE doc_number_bidx = $2 AND user_id <> $1) AS duplicate,
              EXISTS (SELECT 1 FROM identity.kyc_submissions WHERE person_bidx = $3 AND user_id <> $1) AS possible_duplicate,
              EXISTS (SELECT 1 FROM identity.nid_blacklist WHERE doc_number_bidx = $2 AND removed_at IS NULL) AS blacklisted`,
      [userId, docBidx, personBidx],
    );
    return [
      ...(r.duplicate ? ['duplicate'] : []),
      ...(r.possible_duplicate && !r.duplicate ? ['possible_duplicate'] : []),
      ...(r.blacklisted ? ['blacklisted'] : []),
      ...(isAdult ? [] : ['underage']),
    ];
  }

  private validate(input: KycInput, images: Partial<Record<KycFileKind, Buffer>>): { field: string; reason: string }[] {
    const errors: { field: string; reason: string }[] = [];
    if (!validDocNumber(input.docType, input.docNumber)) errors.push({ field: 'docNumber', reason: 'format' });
    const dob = /^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth) ? new Date(`${input.dateOfBirth}T00:00:00Z`) : null;
    if (!dob || isNaN(dob.getTime()) || dob.toISOString().slice(0, 10) !== input.dateOfBirth || dob > this.clock.now() || dob.getUTCFullYear() < 1900) {
      errors.push({ field: 'dateOfBirth', reason: 'format' });
    }
    if (input.fullName.trim().length < 2) errors.push({ field: 'fullName', reason: 'required' });
    const needed = FILES_FOR[input.docType];
    for (const kind of needed) if (!images[kind]) errors.push({ field: kind, reason: 'required' });
    for (const kind of Object.keys(images) as KycFileKind[]) if (!needed.includes(kind)) errors.push({ field: kind, reason: 'not-for-this-document' });
    return errors;
  }

  /** FR-KYC-09: unsubmitted or rejected, and within CP-34 (submissions in the last 30 days). */
  private async assertMaySubmit(userId: string): Promise<void> {
    const [u] = await this.db.query(`SELECT kyc_status FROM identity.users WHERE id = $1`, [userId]);
    if (!u || !['unsubmitted', 'rejected'].includes(u.kyc_status)) throw new Problem('kyc-not-allowed');
    if ((await this.submissionsLeft(userId)) <= 0) throw new Problem('kyc-limit');
  }

  private async submissionsLeft(userId: string): Promise<number> {
    // CP-34: "3 per 30 days"; the parameter is the number, the 30 days are the SRS's fixed window.
    const cp34 = { submissions: (await this.params.current()).get<number>('CP-34'), days: CP34_WINDOW_DAYS };
    const [{ n }] = await this.db.query(
      `SELECT count(*)::int AS n FROM identity.kyc_submissions WHERE user_id = $1 AND submitted_at > $2`,
      [userId, new Date(this.clock.now().getTime() - cp34.days * 86_400_000)],
    );
    return Math.max(cp34.submissions - n, 0);
  }
}
