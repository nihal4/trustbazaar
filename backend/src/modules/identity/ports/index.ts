import type { EntityManager } from 'typeorm';
import type { Principal } from '../../../kernel/http/principal';

// The public surface of Unit 1: the only file other units may import (DC-1, enforced by .eslintrc.js).
// The interfaces are those of docs/design/01_identity_access.pdf section 4.4 and of the integration design
// (docs/design/09_integration.pdf section 4, "Ports"), with the additions of I-8, I-24, I-36 and I-43.
// A unit injects a port with its token, for example  @Inject(IDENTITY_QUERY) private readonly identity: IdentityQuery.
// Every method that changes something takes the caller's transaction where the design asks for it (DC-13).

export type KycStatus = 'unsubmitted' | 'pending_review' | 'verified' | 'rejected' | 'revoked';
export type AccountStatus = 'active' | 'suspended' | 'closed';
export type StaffRole = 'operator' | 'administrator';
export type TransactAction = 'list' | 'bid' | 'buy' | 'payout';
export type SessionEndReason = 'suspended' | 'closed' | 'emergency';
export type BlacklistSource = 'game_account_recovery' | 'fraud_decision';
export type ActorType = 'user' | 'staff' | 'system' | 'provider';

/** Request details for the audit log; optional for calls that do not come from a request (jobs, events). */
export interface CallContext {
  ip?: string | null;
  correlationId?: string | null;
}

export interface PrincipalInfo {
  id: string;
  displayName: string;
  kycStatus: KycStatus;
  accountStatus: AccountStatus;
  emailVerified: boolean;
  /** I-8: when KYC was verified (CP-27 limits); null if not verified. */
  verifiedAt: Date | null;
}

/** FR-ACC-10: what other users may see from Unit 1 (rating and transaction counts come from Unit 7). */
export interface PublicProfile {
  id: string;
  displayName: string;
  verified: boolean;
  joinMonth: string; // YYYY-MM
  district: string | null;
}

export interface IdentityQuery {
  /** With `tx`, read on the caller's transaction: a caller holding row locks must not wait for a second pool connection. */
  getPrincipal(userId: string, tx?: EntityManager): Promise<PrincipalInfo>;
  /** FR-KYC-07, FR-TNS-05, I-43: throws transaction-not-allowed (403) with the reason. */
  assertCanTransact(userId: string, action: TransactAction): Promise<void>;
  getPublicProfile(userId: string): Promise<PublicProfile>;
  /** FR-PAY-17: the verified mobile number (payout wallet match). */
  getVerifiedPhone(userId: string): Promise<string>;
  /** The legal name from the approved KYC submission; decrypted and audited. */
  getKycLegalName(userId: string, purpose: 'bank_payout_check', ctx?: CallContext): Promise<string>;
  /** FR-OPS-06. */
  hasConflict(staffId: string, userId: string): Promise<boolean>;
  /** I-24: the saved district and rounded coordinates, or null. */
  getApproxArea(userId: string): Promise<{ district: string | null; lat: number; lng: number } | null>;
  /** I-36: contact details at send time, so they are never stored with a notification. */
  getContact(userId: string): Promise<{ email: string | null; phone: string | null; emailVerified: boolean }>;
}

export interface IdentityCommands {
  /** FR-TNS-05: ends every session; identity.account.suspended carries the fraud flag (I-8). Audited. */
  suspendAccount(userId: string, reason: string, byStaffId: string, o?: { fraud?: boolean; ctx?: CallContext; tx?: EntityManager }): Promise<void>;
  /** Only with an approved account.reinstate approval for this user (CP-30). */
  reinstateAccount(userId: string, approvalId: string, tx?: EntityManager): Promise<void>;
  endAllSessions(userId: string, reason: SessionEndReason, tx?: EntityManager): Promise<void>;
  /** FR-TNS-06, FR-GAM-18: proposes blacklist.add for the user's verified identity. */
  proposeBlacklist(userId: string, source: BlacklistSource, relatedOrderId: string | null, reason: string, byStaffId: string, ctx?: CallContext): Promise<Approval>;
  /** Proposes account.reinstate (CP-30); a second operator decides it. */
  proposeReinstatement(userId: string, reason: string, byStaffId: string, ctx?: CallContext): Promise<Approval>;
}

export interface StaffQuery {
  /** FR-OPS-06, at every claim (Unit 7): throws conflict-of-interest (403). */
  assertNoConflict(staffId: string, userIds: string[]): Promise<void>;
}

export interface Approval {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  payload: Record<string, unknown>;
  reason: string;
  requiredRole: StaffRole;
  proposedBy: string;
  proposedAt: Date;
  expiresAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  decision: 'approved' | 'rejected' | 'expired' | null;
  decisionNote: string | null;
  executedAt: Date | null;
}

export interface ApprovalServicePort {
  propose(
    p: { action: string; targetType: string; targetId: string; payload?: object; reason: string; requiredRole: StaffRole; byStaffId: string },
    ctx?: CallContext,
    tx?: EntityManager,
  ): Promise<Approval>;
  decide(id: string, byStaffId: string, decision: 'approved' | 'rejected', note?: string, ctx?: CallContext): Promise<Approval>;
  /** One handler per action; it runs in the decision's transaction when the proposal is approved. */
  registerHandler(action: string, h: (a: Approval, tx: EntityManager) => Promise<void>): void;
}

export interface AuditEntry {
  actorType: ActorType;
  actorId?: string | null;
  action: string; // '<unit>.<object>.<past>', e.g. 'orders.refund.issued'
  objectType?: string | null;
  objectId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  approvalId?: string | null;
  sourceIp?: string | null;
  correlationId?: string | null;
}

export interface AuditServicePort {
  /** DC-8: in the same transaction as the action it records. */
  record(e: AuditEntry, tx: EntityManager): Promise<void>;
  verifyChain(): Promise<{ intact: boolean; firstBadId?: string; entries: number }>;
}

export interface RateLimiterPort {
  /** Throws rate-limited (429, Retry-After) when `subject` has used up `rule`. */
  consume(rule: string, subject: string): Promise<void>;
  /** A unit names its own rules once, at start (for example 'bid': 10 per 60 s). */
  define(rule: string, limit: number, windowSeconds: number): void;
}

export type FilePurpose = 'kyc' | 'ownership_proof' | 'dispute_evidence' | 'chat_image' | 'data_export';

export interface StoredFile {
  /** Opaque; the caller keeps it in its own row. It names the file and carries its wrapped key. */
  key: string;
  sha256: string;
  mime: string;
  size: number;
}

export interface FileVaultPort {
  /** Images are identified by content and re-encoded without metadata (SEC-INP-04, SEC-DAT-08); every file is encrypted. */
  store(f: { purpose: FilePurpose; ownerId: string; bytes: Uint8Array }): Promise<StoredFile>;
  /** SEC-DAT-04: a link for this viewer's session (CP-31); a staff view needs a reason and is audited. */
  signedLink(key: string, viewer: Principal, reason?: string, ctx?: CallContext): Promise<{ url: string; expiresAt: string }>;
  /** Deletes the file; the caller then drops the key from its row (crypto-shredding). */
  erase(key: string): Promise<void>;
}

export interface IdentityCryptoPort {
  /** AES-256-GCM under FIELD_KEY_V{n}; the context is the associated data (for example 'delivery.addresses.line1:<id>'). */
  encrypt(plain: string, context: string): Promise<Uint8Array>;
  decrypt(sealed: Uint8Array, context: string): Promise<string>;
}

export const IDENTITY_QUERY = Symbol('IDENTITY_QUERY');
export const IDENTITY_COMMANDS = Symbol('IDENTITY_COMMANDS');
export const STAFF_QUERY = Symbol('STAFF_QUERY');
export const APPROVAL_SERVICE = Symbol('APPROVAL_SERVICE');
export const AUDIT_SERVICE = Symbol('AUDIT_SERVICE');
export const RATE_LIMITER = Symbol('RATE_LIMITER');
export const FILE_VAULT = Symbol('FILE_VAULT');
export const IDENTITY_CRYPTO = Symbol('IDENTITY_CRYPTO');
