// What the wizard knows about a submission (Unit 1 section 6.6): the status answer, the files each
// document needs, and the early checks Unit 1 also makes.
import { toAsciiDigits } from '../../lib/money.js';

export type KycStatus = 'unsubmitted' | 'pending_review' | 'verified' | 'rejected' | 'revoked';
export type DocType = 'nid' | 'passport';
export type ImageKind = 'doc_front' | 'doc_back' | 'passport_photo_page' | 'selfie_neutral' | 'selfie_action';

export interface KycStatusView {
  status: KycStatus;
  changedAt: string;
  rejection: { reason: string; note: string | null } | null;
  submissionsLeft: number;
  expectedReviewHours: number;
}

export interface Challenge {
  challengeId: string;
  action: string;
  expiresAt: string;
}

export const STATUS_KEY = ['kyc', 'status'] as const;

/** FR-KYC-01: the images each document needs, in the order they are taken. */
export const FILES_FOR: Record<DocType, ImageKind[]> = {
  nid: ['doc_front', 'doc_back', 'selfie_neutral', 'selfie_action'],
  passport: ['passport_photo_page', 'selfie_neutral', 'selfie_action'],
};

export const isSelfie = (k: ImageKind) => k === 'selfie_neutral' || k === 'selfie_action';

/**
 * May the user submit now? Unit 1 allows unsubmitted and rejected within CP-34. Revoked is final
 * (identity.check_kyc_transition allows no change out of it).
 */
export const maySubmit = (s: KycStatusView) => (s.status === 'unsubmitted' || s.status === 'rejected') && s.submissionsLeft > 0;

/** NID: 10, 13 or 17 digits; passport: 1-2 letters and 7-8 digits (as Unit 1 checks). */
export function validDocNumber(type: DocType, input: string): boolean {
  const n = toAsciiDigits(input).replace(/[\s-]/g, '');
  return type === 'nid' ? /^(\d{10}|\d{13}|\d{17})$/.test(n) : /^[A-Za-z]{1,2}\d{7,8}$/.test(n);
}

export const normaliseDocNumber = (input: string) => toAsciiDigits(input).replace(/[\s-]/g, '').toUpperCase();

/** A real calendar date, not in the future, not before 1900 (YYYY-MM-DD). */
export function validDateOfBirth(value: string, today = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value && d <= today && d.getUTCFullYear() >= 1900;
}

/** Rejection reasons shown with their own guidance (FR-KYC-06); `blacklisted` reads as `other`. */
export const REASONS = ['image_unreadable', 'selfie_mismatch', 'liveness_failed', 'document_expired', 'details_mismatch',
  'underage', 'duplicate_identity', 'other'] as const;

export function reasonKey(reason: string): string {
  return (REASONS as readonly string[]).includes(reason) ? reason : 'other';
}

export const ACTIONS = ['turn_head_left', 'turn_head_right', 'look_up', 'smile', 'blink_twice'] as const;
