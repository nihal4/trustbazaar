import { randomInt, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { authenticator } from 'otplib';
import { loadConfig } from '../../src/kernel/config/config';
import { startApp, TestApp } from '../support/app';
import { Browser } from '../support/browser';
import { IdentityFixtures } from '../support/identity';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;

// U1-06: KYC submission, review, signed file links, revocation and the NID blacklist (Unit 1 sections 6.6
// and 6.7), over HTTP against PostgreSQL, Redis and a temporary file volume, through the security pipeline.
const problem = async (r: Response) => {
  const b = await r.json();
  return { status: r.status, type: b.type, errors: b.errors };
};
const nid = () => String(randomInt(1e9, 1e10)); // 10 digits
let shade = 0;
const image = async (fmt: 'jpeg' | 'png' = 'jpeg') =>
  sharp({ create: { width: 640, height: 400, channels: 3, background: { r: (shade += 7) % 255, g: 90, b: 160 } } })[fmt]().toBuffer();

describe('KYC', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let origin: string;
  let filesRoot: string;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    const cfg = loadConfig(process.env);
    origin = cfg.publicOrigin;
    filesRoot = cfg.filesRoot;
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  async function user(o: { kyc?: string } = {}) {
    const a = await fx.account({ kyc: o.kyc ?? 'unsubmitted' });
    const b = new Browser(t, origin);
    expect((await b.post('/auth/signin', { login: a.phone, password: a.password })).status).toBe(204);
    return { ...a, b };
  }

  async function operator(role: 'operator' | 'administrator' = 'operator', o: { email?: string } = {}) {
    const s = await fx.staffAccount(role, o);
    const b = new Browser(t, origin, '__Host-tb_scsrf');
    await b.post('/staff/auth/signin', { email: s.email, password: s.password });
    expect((await b.post('/staff/auth/mfa', { code: authenticator.generate(s.totpSecret!) })).status).toBe(204);
    return { ...s, b };
  }

  type Details = { docType?: 'nid' | 'passport'; docNumber?: string; fullName?: string; dateOfBirth?: string };
  async function submit(u: { b: Browser }, d: Details = {}, override: Record<string, Buffer | null> = {}) {
    const challenge = await (await u.b.get('/kyc/liveness-challenge')).json();
    const docType = d.docType ?? 'nid';
    const form = new FormData();
    form.set('docType', docType);
    form.set('docNumber', d.docNumber ?? nid());
    form.set('fullName', d.fullName ?? `Test Person ${randomUUID().slice(0, 8)}`);
    form.set('dateOfBirth', d.dateOfBirth ?? '1995-04-12');
    form.set('challengeId', challenge.challengeId);
    const kinds = docType === 'nid' ? ['doc_front', 'doc_back', 'selfie_neutral', 'selfie_action'] : ['passport_photo_page', 'selfie_neutral', 'selfie_action'];
    for (const kind of kinds) {
      const bytes = kind in override ? override[kind] : await image(kind === 'doc_back' ? 'png' : 'jpeg');
      if (bytes) form.set(kind, new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), `${kind}.jpg`);
    }
    return { r: await u.b.upload('/kyc/submissions', form), challenge };
  }

  async function submitted(u: { b: Browser }, d: Details = {}) {
    const { r } = await submit(u, d);
    expect(r.status).toBe(202);
    return (await r.json()).submissionId as string;
  }

  const claim = (op: { b: Browser }, id: string) => op.b.post(`/staff/kyc/submissions/${id}/claim`);
  const decide = (op: { b: Browser }, id: string, body: object) => op.b.post(`/staff/kyc/submissions/${id}/decision`, body);
  const kycOf = async (userId: string) => (await fx.query(`SELECT kyc_status FROM identity.users WHERE id = $1`, [userId]))[0].kyc_status;
  const flagsOf = async (id: string) => (await fx.query(`SELECT routed_flags FROM identity.kyc_submissions WHERE id = $1`, [id]))[0].routed_flags;

  describe('submission (FR-KYC-01 to FR-KYC-04)', () => {
    it('FR-KYC-01 a submission stores encrypted details and sealed images, and moves the user to pending_review', async () => {
      const u = await user();
      const number = nid();
      const name = `Karim Hossain ${randomUUID().replace(/[^a-f]/g, '')}`; // unique: names repeat across test runs
      const id = await submitted(u, { docNumber: number, fullName: name });
      expect(await kycOf(u.userId)).toBe('pending_review');
      const [s] = await fx.query<Record<string, Buffer | string[]>>(`SELECT * FROM identity.kyc_submissions WHERE id = $1`, [id]);
      for (const col of ['doc_number_enc', 'full_name_enc', 'dob_enc']) {
        const blob = s[col] as Buffer;
        expect(blob.includes(Buffer.from(number))).toBe(false);
        expect(blob.includes(Buffer.from('Karim'))).toBe(false);
      }
      expect(s.routed_flags).toEqual([]);
      const files = await fx.query<{ kind: string; storage_key: string; mime: string }>(
        `SELECT kind, storage_key, mime FROM identity.kyc_files WHERE submission_id = $1 ORDER BY kind`, [id]);
      expect(files.map((f) => f.kind)).toEqual(['doc_front', 'doc_back', 'selfie_neutral', 'selfie_action']); // enum order
      expect(files.every((f) => f.mime === 'image/jpeg')).toBe(true); // the PNG was re-encoded
      const onDisk = await fs.readFile(join(filesRoot, 'kyc', files[0].storage_key));
      expect(onDisk.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false); // not a readable JPEG
      const [h] = await fx.query(`SELECT from_status, to_status, actor_type, actor_id FROM identity.kyc_status_history WHERE user_id = $1`, [u.userId]);
      expect(h).toEqual({ from_status: 'unsubmitted', to_status: 'pending_review', actor_type: 'user', actor_id: u.userId });
      const events = await fx.query(`SELECT event_type FROM identity.outbox WHERE aggregate_id = $1`, [u.userId]);
      expect(events.map((e) => e.event_type)).toContain('identity.kyc.submitted');
      const status = await (await u.b.get('/kyc/status')).json();
      expect(status).toMatchObject({ status: 'pending_review', rejection: null, expectedReviewHours: 48, submissionsLeft: 2 });
    });

    it('FR-KYC-02 a liveness challenge works once, for its own user', async () => {
      const u = await user();
      const { r, challenge } = await submit(u);
      expect(r.status).toBe(202);
      expect(['turn_head_left', 'turn_head_right', 'look_up', 'smile', 'blink_twice']).toContain(challenge.action);
      const [s] = await fx.query(`SELECT liveness_action FROM identity.kyc_submissions WHERE user_id = $1`, [u.userId]);
      expect(s.liveness_action).toBe(challenge.action);

      const other = await user();
      const stolen = (await (await u.b.get('/kyc/liveness-challenge')).status) === 409; // u is pending now
      expect(stolen).toBe(true);
      const ch = await (await other.b.get('/kyc/liveness-challenge')).json();
      const third = await user();
      const form = new FormData();
      for (const [k, v] of Object.entries({ docType: 'nid', docNumber: nid(), fullName: 'Someone Else', dateOfBirth: '1990-01-01', challengeId: ch.challengeId })) form.set(k, v);
      for (const kind of ['doc_front', 'doc_back', 'selfie_neutral', 'selfie_action']) form.set(kind, new Blob([new Uint8Array(await image())]), 'x.jpg');
      expect(await problem(await third.b.upload('/kyc/submissions', form))).toMatchObject({ status: 400, errors: [{ field: 'challengeId', reason: 'expired-or-used' }] });
    });

    it('SEC-INP-04 a file that is not an image is refused and nothing is kept', async () => {
      const u = await user();
      const before = (await fs.readdir(join(filesRoot, 'kyc')).catch(() => [])).length;
      const { r } = await submit(u, {}, { selfie_action: Buffer.from('<?php echo "hi"; ?>') });
      expect(await problem(r)).toMatchObject({ status: 400, errors: [{ field: 'selfie_action', reason: 'not-an-image' }] });
      expect(await kycOf(u.userId)).toBe('unsubmitted');
      expect((await fs.readdir(join(filesRoot, 'kyc'))).length).toBe(before);
    });

    it('FR-KYC-01 every image of the document type is required', async () => {
      const u = await user();
      const { r } = await submit(u, {}, { doc_back: null });
      expect(await problem(r)).toMatchObject({ status: 400, errors: [{ field: 'doc_back', reason: 'required' }] });
      const p = await submit(u, { docType: 'passport', docNumber: 'A01234567' });
      expect(p.r.status).toBe(202);
    });

    it('FR-KYC-03 an under-18 date of birth is flagged, can only be rejected, and the reason reaches the user', async () => {
      const u = await user();
      const id = await submitted(u, { dateOfBirth: '2010-06-01' });
      expect(await flagsOf(id)).toEqual(['underage']);
      const op = await operator();
      await claim(op, id);
      expect(await problem(await decide(op, id, { decision: 'approve' }))).toMatchObject({ status: 409, errors: [{ reason: 'underage' }] });
      expect((await decide(op, id, { decision: 'reject', reason: 'underage', note: 'You must be 18 or older.' })).status).toBe(200);
      expect(await (await u.b.get('/kyc/status')).json()).toMatchObject({ status: 'rejected', rejection: { reason: 'underage', note: 'You must be 18 or older.' } });
    });

    it('FR-KYC-04 one document number cannot verify two accounts; the second is flagged and cannot be approved', async () => {
      const number = nid();
      const first = await user();
      const op = await operator();
      const a = await submitted(first, { docNumber: number, fullName: 'Rahim Uddin', dateOfBirth: '1990-01-02' });
      await claim(op, a);
      expect((await decide(op, a, { decision: 'approve' })).status).toBe(200);
      expect(await kycOf(first.userId)).toBe('verified');

      const second = await user();
      const b = await submitted(second, { docNumber: number.replace(/(\d{4})(\d{3})/, '$1-$2 '), fullName: 'Another Name' });
      expect(await flagsOf(b)).toEqual(['duplicate']);
      await claim(op, b);
      expect(await problem(await decide(op, b, { decision: 'approve' }))).toMatchObject({ status: 409, errors: [{ reason: 'duplicate_identity' }] });
      expect(await kycOf(second.userId)).toBe('pending_review');

      // A different number with the same name and date of birth is only a possible duplicate (a signal).
      const third = await user();
      const c = await submitted(third, { docNumber: nid(), fullName: 'RAHIM  UDDIN', dateOfBirth: '1990-01-02' });
      expect(await flagsOf(c)).toEqual(['possible_duplicate']);
    });

    it('FR-KYC-09 a rejected user may resubmit, up to CP-34; a pending one may not submit again', async () => {
      const u = await user();
      const op = await operator();
      for (let i = 0; i < 3; i++) {
        const id = await submitted(u);
        expect((await problem(await u.b.get('/kyc/liveness-challenge'))).type).toBe('/problems/kyc-not-allowed'); // already pending
        await claim(op, id);
        await decide(op, id, { decision: 'reject', reason: 'image_unreadable' });
      }
      expect(await problem((await u.b.get('/kyc/liveness-challenge')))).toMatchObject({ status: 409, type: '/problems/kyc-limit' });
      expect(await (await u.b.get('/kyc/status')).json()).toMatchObject({ status: 'rejected', submissionsLeft: 0 });
    });
  });

  describe('review (FR-KYC-05, FR-KYC-06, SEC-ACC-06)', () => {
    it('SEC-ACC-06 two operators claiming one submission: exactly one gets it, and only they see the details', async () => {
      const u = await user();
      const id = await submitted(u, { fullName: 'Nasrin Akter', dateOfBirth: '1992-03-04' });
      const [a, b] = [await operator(), await operator()];
      const answers = await Promise.all([claim(a, id), claim(b, id)]);
      expect(answers.map((r) => r.status).sort()).toEqual([200, 409]);
      const winner = answers[0].status === 200 ? a : b;
      const loser = winner === a ? b : a;
      expect((await loser.b.get(`/staff/kyc/submissions/${id}`)).status).toBe(409);
      const d = await (await winner.b.get(`/staff/kyc/submissions/${id}`)).json();
      expect(d).toMatchObject({ fullName: 'Nasrin Akter', dateOfBirth: '1992-03-04', docType: 'nid', isAdult: true });
      const audit = await fx.query(`SELECT actor_id FROM audit.events WHERE action = 'kyc.details.viewed' AND object_id = $1`, [id]);
      expect(audit).toEqual([{ actor_id: winner.staffId }]);
    });

    it('FR-OPS-03 an administrator cannot see the KYC queue or documents', async () => {
      const admin = await operator('administrator');
      expect((await admin.b.get('/staff/kyc/queue')).status).toBe(403);
    });

    it('FR-OPS-06 an operator cannot claim the submission of a user with their own e-mail', async () => {
      const u = await user();
      const id = await submitted(u);
      const op = await operator('operator', { email: u.email.toLowerCase() });
      expect((await problem(await claim(op, id))).type).toBe('/problems/conflict-of-interest');
    });

    it('FR-KYC-12 the queue lists pending submissions oldest first, with flags and age', async () => {
      const u = await user();
      const id = await submitted(u, { dateOfBirth: '2012-01-01' });
      const op = await operator();
      const q = await (await op.b.get('/staff/kyc/queue')).json();
      const times = q.map((x: { submittedAt: string }) => Date.parse(x.submittedAt));
      expect([...times].sort((x, y) => x - y)).toEqual(times);
      // The queue shows the 200 oldest. On a database that earlier runs filled with pending submissions,
      // the newest is beyond them; otherwise it is listed, with its flags.
      const item = q.find((x: { id: string }) => x.id === id);
      if (q.length < 200) expect(item).toMatchObject({ userId: u.userId, flags: ['underage'], overdue: false, claimedBy: null });
      else expect(item).toBeUndefined();
    });

    it('FR-KYC-05 approval verifies the user, records the claim, the history with actor, and the event', async () => {
      const u = await user();
      const id = await submitted(u);
      const op = await operator();
      expect((await decide(op, id, { decision: 'approve' })).status).toBe(409); // not claimed yet
      await claim(op, id);
      expect(await (await decide(op, id, { decision: 'approve' })).json()).toEqual({ status: 'approved' });
      expect(await kycOf(u.userId)).toBe('verified');
      expect(await fx.query(`SELECT 1 FROM identity.identity_claims WHERE user_id = $1`, [u.userId])).toHaveLength(1);
      const hist = await fx.query(`SELECT to_status, actor_type, actor_id FROM identity.kyc_status_history WHERE user_id = $1 ORDER BY id`, [u.userId]);
      expect(hist.at(-1)).toEqual({ to_status: 'verified', actor_type: 'staff', actor_id: op.staffId });
      const events = await fx.query(`SELECT event_type FROM identity.outbox WHERE aggregate_id = $1`, [u.userId]);
      expect(events.map((e) => e.event_type)).toContain('identity.kyc.verified');
    });

    it('FR-KYC-06 a rejection needs a reason code from the fixed list', async () => {
      const u = await user();
      const id = await submitted(u);
      const op = await operator();
      await claim(op, id);
      expect((await decide(op, id, { decision: 'reject' })).status).toBe(400);
      expect((await decide(op, id, { decision: 'reject', reason: 'looks_odd' })).status).toBe(400);
      expect((await decide(op, id, { decision: 'reject', reason: 'selfie_mismatch' })).status).toBe(200);
      const [h] = await fx.query(`SELECT reason FROM identity.kyc_status_history WHERE user_id = $1 AND to_status = 'rejected'`, [u.userId]);
      expect(h.reason).toBe('selfie_mismatch');
    });
  });

  describe('protected files (SEC-DAT-04, SEC-ACC-06)', () => {
    it('SEC-DAT-04 the claimant opens an image through a signed link with a reason; another session cannot use it', async () => {
      const u = await user();
      const id = await submitted(u);
      const op = await operator();
      await claim(op, id);
      expect((await op.b.post(`/staff/kyc/submissions/${id}/files/selfie_neutral/view`, {})).status).toBe(400); // no reason
      const r = await op.b.post(`/staff/kyc/submissions/${id}/files/selfie_neutral/view`, { reason: 'Comparing selfie with document' });
      const { url } = await r.json();
      expect(url).toMatch(/^\/api\/v1\/files\/v\//);
      const img = await op.b.get(url.replace('/api/v1', ''));
      expect(img.status).toBe(200);
      expect(img.headers.get('content-type')).toBe('image/jpeg');
      expect(img.headers.get('cache-control')).toBe('no-store');
      expect(img.headers.get('x-content-type-options')).toBe('nosniff');
      expect(img.headers.get('content-security-policy')).toContain('sandbox');
      expect((await sharp(Buffer.from(await img.arrayBuffer())).metadata()).format).toBe('jpeg');

      const elsewhere = await operator();
      expect((await elsewhere.b.get(url.replace('/api/v1', ''))).status).toBe(410);
      expect((await new Browser(t, origin).get(url.replace('/api/v1', ''))).status).toBe(410);
      const [a] = await fx.query(`SELECT reason FROM audit.events WHERE action = 'kyc.file.viewed' AND actor_id = $1`, [op.staffId]);
      expect(a.reason).toBe('Comparing selfie with document');
    });

    it('SEC-ACC-06 the owner sees their own images; another user cannot', async () => {
      const u = await user();
      await submitted(u);
      const { url } = await (await u.b.post('/kyc/files/doc_front/view')).json();
      expect((await u.b.get(url.replace('/api/v1', ''))).status).toBe(200);
      const other = await user();
      expect((await other.b.get(url.replace('/api/v1', ''))).status).toBe(410);
    });
  });

  describe('revocation and blacklist (FR-KYC-10, FR-TNS-06)', () => {
    async function verified() {
      const u = await user();
      const number = nid();
      const id = await submitted(u, { docNumber: number });
      const op = await operator();
      await claim(op, id);
      await decide(op, id, { decision: 'approve' });
      return { ...u, number };
    }

    it('FR-KYC-10 revocation takes effect only when a second operator approves it; the identity stays claimed', async () => {
      const u = await verified();
      const [a, b] = [await operator(), await operator()];
      const p = await (await a.b.post(`/staff/users/${u.userId}/kyc/revoke`, { reason: 'Document reported stolen' })).json();
      expect(await kycOf(u.userId)).toBe('verified');
      expect((await a.b.post(`/staff/approvals/${p.id}/decision`, { decision: 'approved' })).status).toBe(403);
      expect((await b.b.post(`/staff/approvals/${p.id}/decision`, { decision: 'approved' })).status).toBe(200);
      expect(await kycOf(u.userId)).toBe('revoked');
      const [h] = await fx.query(`SELECT approval_id, actor_id FROM identity.kyc_status_history WHERE user_id = $1 AND to_status = 'revoked'`, [u.userId]);
      expect(h).toEqual({ approval_id: p.id, actor_id: b.staffId });
      expect(await fx.query(`SELECT 1 FROM identity.identity_claims WHERE user_id = $1`, [u.userId])).toHaveLength(1);
    });

    it('FR-TNS-06 a blacklisted identity is flagged on a new submission and cannot be approved; removal needs its own approval', async () => {
      const u = await verified();
      const [a, b] = [await operator(), await operator()];
      const p = await (await a.b.post('/staff/blacklist', { userId: u.userId, source: 'fraud_decision', reason: 'Confirmed fraud in a dispute' })).json();
      await b.b.post(`/staff/approvals/${p.id}/decision`, { decision: 'approved' });
      const [entry] = await fx.query(`SELECT id, add_approval_id FROM identity.nid_blacklist WHERE add_approval_id = $1`, [p.id]);
      expect(entry).toBeDefined();

      const next = await user();
      const id = await submitted(next, { docNumber: u.number });
      expect(await flagsOf(id)).toEqual(['duplicate', 'blacklisted']);
      await claim(a, id);
      expect(await problem(await decide(a, id, { decision: 'approve' }))).toMatchObject({ errors: [{ reason: 'blacklisted' }] });

      const r = await (await a.b.post(`/staff/blacklist/${entry.id}/remove`, { reason: 'Decision overturned on appeal' })).json();
      await b.b.post(`/staff/approvals/${r.id}/decision`, { decision: 'approved' });
      const [after] = await fx.query(`SELECT removed_at, remove_approval_id FROM identity.nid_blacklist WHERE id = $1`, [entry.id]);
      expect(after.remove_approval_id).toBe(r.id);
    });
  });
});
