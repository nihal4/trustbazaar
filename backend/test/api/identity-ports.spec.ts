import { randomInt, randomUUID } from 'crypto';
import { authenticator } from 'otplib';
import { DataSource } from 'typeorm';
import { loadConfig } from '../../src/kernel/config/config';
import type { Principal } from '../../src/kernel/http/principal';
import {
  APPROVAL_SERVICE, ApprovalServicePort, AUDIT_SERVICE, AuditServicePort, FILE_VAULT, FileVaultPort, IDENTITY_COMMANDS, IDENTITY_CRYPTO,
  IDENTITY_QUERY, IdentityCommands, IdentityCryptoPort, IdentityQuery, RATE_LIMITER, RateLimiterPort, STAFF_QUERY, StaffQuery,
} from '../../src/modules/identity/ports';
import { KycReviewService } from '../../src/modules/identity/services/kyc-review.service';
import { KycService } from '../../src/modules/identity/services/kyc.service';
import { startApp, TestApp } from '../support/app';
import { Browser } from '../support/browser';
import { IdentityFixtures } from '../support/identity';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;

// U1-08: Unit 1's ports, as the other units will call them (Unit 1 section 4.4; Unit 9 section 4; I-8, I-24,
// I-36, I-43), against PostgreSQL and Redis.
describe('identity ports', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let origin: string;
  let query: IdentityQuery;
  let commands: IdentityCommands;
  let staffQuery: StaffQuery;
  let approvals: ApprovalServicePort;
  let audit: AuditServicePort;
  let limiter: RateLimiterPort;
  let vault: FileVaultPort;
  let crypto: IdentityCryptoPort;
  let db: DataSource;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    origin = loadConfig(process.env).publicOrigin;
    query = t.app.get(IDENTITY_QUERY);
    commands = t.app.get(IDENTITY_COMMANDS);
    staffQuery = t.app.get(STAFF_QUERY);
    approvals = t.app.get(APPROVAL_SERVICE);
    audit = t.app.get(AUDIT_SERVICE);
    limiter = t.app.get(RATE_LIMITER);
    vault = t.app.get(FILE_VAULT);
    crypto = t.app.get(IDENTITY_CRYPTO);
    db = t.app.get(DataSource);
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  const reason = (e: unknown) => (e as { extra?: { errors?: { reason: string }[] } }).extra?.errors?.[0]?.reason;
  async function signedIn(o: { kyc?: string } = {}) {
    const a = await fx.account({ kyc: o.kyc });
    const b = new Browser(t, origin);
    expect((await b.post('/auth/signin', { login: a.phone, password: a.password })).status).toBe(204);
    return { ...a, b };
  }

  describe('IdentityQuery', () => {
    it('FR-KYC-07 assertCanTransact allows a verified, e-mail-verified, active user and names the reason otherwise', async () => {
      const ok = await fx.account();
      await expect(query.assertCanTransact(ok.userId, 'bid')).resolves.toBeUndefined();
      const pending = await fx.account({ kyc: 'pending_review' });
      await expect(query.assertCanTransact(pending.userId, 'list')).rejects.toMatchObject({ problem: 'transaction-not-allowed' });
      expect(await query.assertCanTransact(pending.userId, 'list').catch(reason)).toBe('kyc-not-verified');
      const noEmail = await fx.user({ emailVerified: false });
      expect(await query.assertCanTransact(noEmail, 'buy').catch(reason)).toBe('email-not-verified');
    });

    it('I-8 getPrincipal returns the account facts and when KYC was verified', async () => {
      const a = await fx.account({ kyc: 'pending_review' });
      expect(await query.getPrincipal(a.userId)).toMatchObject({ id: a.userId, kycStatus: 'pending_review', accountStatus: 'active', emailVerified: true, verifiedAt: null });
      await db.query(`UPDATE identity.users SET kyc_status = 'verified' WHERE id = $1`, [a.userId]);
      await db.query(`INSERT INTO identity.kyc_status_history (user_id, from_status, to_status, actor_type) VALUES ($1, 'pending_review', 'verified', 'system')`, [a.userId]);
      expect((await query.getPrincipal(a.userId)).verifiedAt).toBeInstanceOf(Date);
    });

    it('FR-ACC-10 the public profile has only the display name, badge, join month and district', async () => {
      const a = await fx.account();
      await db.query(`UPDATE identity.users SET area_district = 'Dhaka', approx_lat = 23.811, approx_lng = 90.412 WHERE id = $1`, [a.userId]);
      const p = await query.getPublicProfile(a.userId);
      expect(Object.keys(p).sort()).toEqual(['displayName', 'district', 'id', 'joinMonth', 'verified']);
      expect(p).toMatchObject({ verified: true, district: 'Dhaka' });
      expect(p.joinMonth).toMatch(/^\d{4}-\d{2}$/);
      expect(JSON.stringify(p)).not.toContain(a.phone);
    });

    it('I-24 I-36 the approximate area, the verified number and the contact details at send time', async () => {
      const a = await fx.account();
      expect(await query.getApproxArea(a.userId)).toBeNull();
      await db.query(`UPDATE identity.users SET area_district = 'Sylhet', approx_lat = 24.894, approx_lng = 91.868 WHERE id = $1`, [a.userId]);
      expect(await query.getApproxArea(a.userId)).toEqual({ district: 'Sylhet', lat: 24.894, lng: 91.868 });
      expect(await query.getVerifiedPhone(a.userId)).toBe(a.phone);
      const c = await query.getContact(a.userId);
      expect({ ...c, email: c.email?.toLowerCase() }).toEqual({ email: a.email.toLowerCase(), phone: a.phone, emailVerified: true });
    });

    it('FR-PAY-17 the KYC legal name is decrypted from the approved submission, and the read is audited', async () => {
      const a = await fx.account({ kyc: 'unsubmitted' });
      const op = await fx.staffAccount('operator');
      const kyc = t.app.get(KycService);
      const review = t.app.get(KycReviewService);
      const ctx = { ip: null, userAgent: null, correlationId: null };
      const ch = await kyc.livenessChallenge(a.userId);
      const img = await sharp({ create: { width: 300, height: 200, channels: 3, background: 'white' } }).jpeg().toBuffer();
      const { submissionId } = await kyc.submit(
        a.userId,
        { docType: 'nid', docNumber: String(randomInt(1e9, 1e10)), fullName: 'Ayesha Siddiqua', dateOfBirth: '1993-07-15', challengeId: ch.challengeId },
        { doc_front: img, doc_back: img, selfie_neutral: img, selfie_action: img },
        ctx,
      );
      await review.claim(op.staffId, submissionId, ctx);
      await review.decide(op.staffId, submissionId, { decision: 'approve' }, ctx);
      expect(await query.getKycLegalName(a.userId, 'bank_payout_check')).toBe('Ayesha Siddiqua');
      const rows = await fx.query(`SELECT reason FROM audit.events WHERE action = 'identity.kyc.legal_name_read' AND object_id = $1`, [a.userId]);
      expect(rows).toEqual([{ reason: 'bank_payout_check' }]);
    });
  });

  describe('IdentityCommands', () => {
    it('FR-TNS-05 suspension ends every session and refuses transactions; the event carries the fraud flag (I-8)', async () => {
      const u = await signedIn();
      const op = await fx.staffAccount('operator');
      await commands.suspendAccount(u.userId, 'Suspected fraud in an order', op.staffId, { fraud: true });
      expect((await u.b.get('/auth/sessions')).status).toBe(401);
      expect(await query.assertCanTransact(u.userId, 'payout').catch(reason)).toBe('suspended');
      const [ev] = await fx.query(`SELECT payload FROM identity.outbox WHERE aggregate_id = $1 AND event_type = 'identity.account.suspended'`, [u.userId]);
      expect(ev.payload).toEqual({ userId: u.userId, fraud: true });
      // The user can still sign in to follow paid orders.
      expect((await new Browser(t, origin).post('/auth/signin', { login: u.phone, password: u.password })).status).toBe(204);
    });

    it('FR-OPS-05 reinstatement needs an approved account.reinstate by a second operator', async () => {
      const u = await fx.account();
      const [a, b] = [await fx.staffAccount('operator'), await fx.staffAccount('operator')];
      await commands.suspendAccount(u.userId, 'Reported for fake listings', a.staffId);
      await expect(commands.reinstateAccount(u.userId, randomUUID())).rejects.toMatchObject({ problem: 'forbidden' });
      const p = await commands.proposeReinstatement(u.userId, 'Listings were checked and genuine', a.staffId);
      await expect(approvals.decide(p.id, a.staffId, 'approved')).rejects.toMatchObject({ problem: 'own-proposal' });
      const done = await approvals.decide(p.id, b.staffId, 'approved', 'Agreed');
      expect(done.executedAt).not.toBeNull();
      expect((await query.getPrincipal(u.userId)).accountStatus).toBe('active');
    });

    it('SEC-SES-05 endAllSessions ends every session of the user', async () => {
      const u = await signedIn();
      await commands.endAllSessions(u.userId, 'emergency');
      expect((await u.b.get('/auth/sessions')).status).toBe(401);
    });
  });

  describe('StaffQuery, ApprovalService, AuditService, RateLimiter, IdentityCrypto', () => {
    it('FR-OPS-06 assertNoConflict refuses when any of the users conflicts with the staff member', async () => {
      const a = await fx.account();
      const other = await fx.account();
      const op = await fx.staffAccount('operator', { email: a.email.toLowerCase() });
      await expect(staffQuery.assertNoConflict(op.staffId, [other.userId])).resolves.toBeUndefined();
      await expect(staffQuery.assertNoConflict(op.staffId, [other.userId, a.userId])).rejects.toMatchObject({ problem: 'conflict-of-interest' });
    });

    it('FR-OPS-05 another unit registers a handler; it runs in the decision’s transaction, with the audit entry', async () => {
      const action = `test.action_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
      const target = randomUUID();
      approvals.registerHandler(action, async (a, tx) => {
        await audit.record({ actorType: 'staff', actorId: a.decidedBy, action: 'test.effect.applied', objectId: a.targetId, approvalId: a.id }, tx);
      });
      expect(() => approvals.registerHandler(action, async () => undefined)).toThrow();
      const [x, y] = [await fx.staffAccount('administrator'), await fx.staffAccount('administrator')];
      const p = await approvals.propose({ action, targetType: 'test', targetId: target, reason: 'A test of the handler registry', requiredRole: 'administrator', byStaffId: x.staffId });
      await approvals.decide(p.id, y.staffId, 'approved');
      const rows = await fx.query(`SELECT approval_id FROM audit.events WHERE action = 'test.effect.applied' AND object_id = $1`, [target]);
      expect(rows).toEqual([{ approval_id: p.id }]);
      expect((await audit.verifyChain()).intact).toBe(true);
    });

    it('SEC-ABU-01 a unit defines its own rate-limit rule and consumes it per subject', async () => {
      const rule = `test_rule_${randomUUID().slice(0, 8)}`;
      limiter.define(rule, 2, 60);
      expect(() => limiter.define(rule, 5, 60)).toThrow();
      const subject = randomUUID();
      await limiter.consume(rule, subject);
      await limiter.consume(rule, subject);
      await expect(limiter.consume(rule, subject)).rejects.toMatchObject({ problem: 'rate-limited' });
      await expect(limiter.consume(rule, randomUUID())).resolves.toBeUndefined();
    });

    it('SEC-DAT-03 IdentityCrypto opens a value only with its own context', async () => {
      const sealed = await crypto.encrypt('House 12, Road 4, Dhanmondi', 'delivery.addresses.line1:abc');
      expect(Buffer.from(sealed).includes(Buffer.from('Dhanmondi'))).toBe(false);
      expect(await crypto.decrypt(sealed, 'delivery.addresses.line1:abc')).toBe('House 12, Road 4, Dhanmondi');
      await expect(crypto.decrypt(sealed, 'delivery.addresses.line1:other')).rejects.toThrow();
    });
  });

  describe('FileVault', () => {
    it('SEC-DAT-08 a stored image is re-encoded without metadata, encrypted, and served only to the viewer’s session', async () => {
      const u = await signedIn();
      const tagged = await sharp({ create: { width: 800, height: 600, channels: 3, background: 'blue' } })
        .jpeg().withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '23/1 48/1 0/1' } }).toBuffer();
      const f = await vault.store({ purpose: 'ownership_proof', ownerId: u.userId, bytes: tagged });
      expect(f).toMatchObject({ mime: 'image/jpeg' });
      expect(f.key).toMatch(/^v1\.ownership_proof\./);

      const [s] = await fx.query<{ id: string }>(`SELECT id FROM identity.sessions WHERE user_id = $1 AND ended_at IS NULL`, [u.userId]);
      const viewer: Principal = { type: 'user', userId: u.userId, sessionId: s.id, accountStatus: 'active', kycStatus: 'verified', emailVerified: true };
      const { url } = await vault.signedLink(f.key, viewer);
      const r = await u.b.get(url.replace('/api/v1', ''));
      expect(r.status).toBe(200);
      const served = Buffer.from(await r.arrayBuffer());
      expect((await sharp(served).metadata()).exif).toBeUndefined();
      expect((await new Browser(t, origin).get(url.replace('/api/v1', ''))).status).toBe(410);

      await vault.erase(f.key);
      expect((await u.b.get(url.replace('/api/v1', ''))).status).toBe(410);
    });

    it('SEC-ACC-06 a staff link needs a reason and is audited; a non-image is refused for an image purpose', async () => {
      const op = await fx.staffAccount('operator');
      const b = new Browser(t, origin, '__Host-tb_scsrf');
      await b.post('/staff/auth/signin', { email: op.email, password: op.password });
      await b.post('/staff/auth/mfa', { code: authenticator.generate(op.totpSecret!) });
      const [s] = await fx.query<{ id: string }>(`SELECT id FROM identity.sessions WHERE staff_id = $1 AND ended_at IS NULL`, [op.staffId]);
      const viewer: Principal = { type: 'staff', staffId: op.staffId, sessionId: s.id, role: 'operator' };
      const img = await sharp({ create: { width: 50, height: 50, channels: 3, background: 'red' } }).png().toBuffer();
      const f = await vault.store({ purpose: 'dispute_evidence', ownerId: randomUUID(), bytes: img });
      await expect(vault.signedLink(f.key, viewer)).rejects.toMatchObject({ problem: 'validation-failed' });
      const { url } = await vault.signedLink(f.key, viewer, 'Reviewing evidence for a dispute');
      expect((await b.get(url.replace('/api/v1', ''))).status).toBe(200);
      const [a] = await fx.query(`SELECT reason FROM audit.events WHERE action = 'files.file.viewed' AND actor_id = $1`, [op.staffId]);
      expect(a.reason).toBe('Reviewing evidence for a dispute');
      await expect(vault.store({ purpose: 'chat_image', ownerId: randomUUID(), bytes: Buffer.from('not an image at all') })).rejects.toMatchObject({ problem: 'validation-failed' });
    });
  });
});
