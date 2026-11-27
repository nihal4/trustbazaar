import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { Problem } from '../../../kernel/http/problems';
import type { Principal } from '../../../kernel/http/principal';
import { GAME_ACCOUNT_QUERIES, GameAccountQueries, GameEvidence } from '../../game-accounts/ports';
import { AUDIT_SERVICE, AuditServicePort, CallContext, FILE_VAULT, FileVaultPort } from '../../identity/ports';

// pdfkit is a CommonJS module with `export =` (no default export without esModuleInterop)
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit') as typeof import('pdfkit');

// The evidence pack (docs/design/07_disputes_trust_staff.pdf section 5.8, FR-GAM-18; U7-10, second part):
// GET /staff/disputes/{id}/evidence-pack, for the assigned operator, made on request for law enforcement. One PDF:
// the dispute, its history and statements, the list of evidence files, and for a game account Unit 5's evidence (the
// ownership proof, the handover, the takeover confirmations and the full credential-access log), ending with the
// SHA-256 list of every file it refers to. The files themselves are not embedded; their hashes let them be checked.
// Never the credentials or a key. The PDF is kept in Unit 1's FileVault (export purpose) and served by a signed link
// valid CP-31; its creation and the link are audited.

interface PackDispute {
  id: string;
  order_id: string;
  buyer_id: string;
  seller_id: string;
  item_kind: string;
  type: string;
  description: string;
  status: string;
  opened_by: string;
  opened_at: Date;
  outcome: string | null;
  decision_reason: string | null;
  decided_at: Date | null;
  assigned_to: string | null;
}
type Line = [string, string | number | null | undefined];

@Injectable()
export class EvidencePackService {
  constructor(
    private readonly db: DataSource,
    @Inject(GAME_ACCOUNT_QUERIES) private readonly games: GameAccountQueries,
    @Inject(FILE_VAULT) private readonly vault: FileVaultPort,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Builds the evidence pack of a dispute for a staff member: a download link with its expiry and the pack's checksum. */
  async create(
    staff: Extract<Principal, { type: 'staff' }>,
    disputeId: string,
    ctx: CallContext = {},
  ): Promise<{ url: string; expiresAt: string; sha256: string; files: number }> {
    const [d] = (await this.db.query(`SELECT * FROM disputes.disputes WHERE id = $1`, [disputeId])) as PackDispute[];
    if (!d) throw new Problem('not-found');
    if (d.assigned_to !== staff.staffId) throw new Problem('not-claimed');
    const [history, statements, evidence, game] = await Promise.all([
      this.db.query(`SELECT from_status, to_status, actor, reason, at FROM disputes.history WHERE dispute_id = $1 ORDER BY id`, [disputeId]) as Promise<
        { from_status: string | null; to_status: string; actor: string; reason: string | null; at: Date }[]
      >,
      this.db.query(`SELECT party, text, at FROM disputes.statements WHERE dispute_id = $1 ORDER BY id`, [disputeId]) as Promise<
        { party: string; text: string | null; at: Date }[]
      >,
      this.db.query(
        `SELECT id, party, mime, byte_size, encode(sha256, 'hex') AS sha256, purged_at, at FROM disputes.evidence WHERE dispute_id = $1 ORDER BY at, id`,
        [disputeId],
      ) as Promise<{ id: string; party: string; mime: string; byte_size: number; sha256: string; purged_at: Date | null; at: Date }[]>,
      d.item_kind === 'game_account' ? this.games.evidence(d.order_id) : Promise.resolve(null),
    ]);
    const hashes: Line[] = evidence.map((e) => [`dispute evidence ${e.id}${e.purged_at ? ' (file erased at the end of retention)' : ''}`, e.sha256]);
    if (game?.proof?.screenshotSha256)
      hashes.push([
        `ownership screenshot of proof ${game.proof.code}${game.proof.screenshotKey ? '' : ' (file erased at the end of retention)'}`,
        game.proof.screenshotSha256,
      ]);

    const pdf = await render(d, history, statements, evidence, game, hashes, { by: staff.staffId, at: this.clock.now() });
    const stored = await this.vault.store({ purpose: 'data_export', ownerId: d.buyer_id, bytes: pdf });
    const sha256 = createHash('sha256').update(pdf).digest('hex');
    await this.db.transaction((m) =>
      this.audit.record(
        {
          actorType: 'staff',
          actorId: staff.staffId,
          action: 'disputes.evidence_pack.created',
          objectType: 'dispute',
          objectId: disputeId,
          after: { sha256, files: hashes.length, bytes: pdf.length },
          sourceIp: ctx.ip ?? null,
          correlationId: ctx.correlationId ?? null,
        },
        m,
      ),
    );
    const link = await this.vault.signedLink(stored.key, staff, `Evidence pack of dispute ${disputeId}`, ctx);
    return { ...link, sha256, files: hashes.length };
  }
}

/** The PDF itself: plain text sections, uncompressed so that it can be read and searched by any tool. */
export function render(
  d: PackDispute,
  history: { from_status: string | null; to_status: string; actor: string; reason: string | null; at: Date }[],
  statements: { party: string; text: string | null; at: Date }[],
  evidence: { id: string; party: string; mime: string; byte_size: number; sha256: string; purged_at: Date | null; at: Date }[],
  game: GameEvidence | null,
  hashes: Line[],
  made: { by: string; at: Date },
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    compress: false,
    info: { Title: `TrustBazaar evidence pack, dispute ${d.id}`, Author: 'TrustBazaar', CreationDate: made.at },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const iso = (x: Date | null | undefined) => (x ? x.toISOString() : '—');
  const heading = (t: string) => doc.moveDown(0.8).font('Helvetica-Bold').fontSize(12).text(t).font('Helvetica').fontSize(9).moveDown(0.2);
  const lines = (rows: Line[]) => rows.forEach(([k, v]) => doc.text(`${k}: ${v === null || v === undefined || v === '' ? '—' : v}`));

  doc.font('Helvetica-Bold').fontSize(16).text('TrustBazaar evidence pack');
  doc.font('Helvetica').fontSize(9).text(`Dispute ${d.id}, order ${d.order_id}. Made ${made.at.toISOString()} by staff member ${made.by}, on request.`);
  doc.text('It never contains account credentials or keys. Files are listed with their SHA-256 hashes, not embedded.');

  heading('1. The dispute');
  lines([
    ['Item', d.item_kind],
    ['Type', d.type],
    ['Status', d.status],
    ['Opened by', d.opened_by],
    ['Opened at', iso(d.opened_at)],
    ['Buyer', d.buyer_id],
    ['Seller', d.seller_id],
    ['Outcome', d.outcome],
    ['Decided at', iso(d.decided_at)],
    ['Decision reason', d.decision_reason],
  ]);
  doc.text(`Description: ${d.description}`);

  heading('2. History');
  history.forEach((h) => doc.text(`${iso(h.at)}  ${h.from_status ?? '—'} -> ${h.to_status}  (${h.actor})${h.reason ? `  ${h.reason}` : ''}`));

  heading('3. Statements');
  if (!statements.length) doc.text('None.');
  statements.forEach((s) => doc.text(`${iso(s.at)}  ${s.party}: ${s.text ?? '[text erased at the end of retention]'}`));

  heading('4. Evidence files');
  if (!evidence.length) doc.text('None.');
  evidence.forEach((e) => doc.text(`${iso(e.at)}  ${e.party}  ${e.id}  ${e.mime}, ${e.byte_size} bytes${e.purged_at ? `, erased ${iso(e.purged_at)}` : ''}`));

  if (game) {
    heading('5. Game account (Unit 5)');
    if (game.details)
      lines([
        ['Game', game.details.game],
        ['Platform', game.details.platform],
        ['Player ID', game.details.playerId],
        ['Contents', game.details.contents],
      ]);
    if (game.proof) {
      doc.moveDown(0.3).text('Ownership proof:');
      lines([
        ['Code', game.proof.code],
        ['Status', game.proof.status],
        ['Submitted at', iso(game.proof.submittedAt)],
        ['Reviewed at', iso(game.proof.reviewedAt)],
        ['Reviewed by', game.proof.reviewedBy],
        ['Live profile check', game.proof.liveCheck],
        ['Review reason', game.proof.reason],
      ]);
    }
    const h = game.handover;
    doc.moveDown(0.3).text('Handover:');
    lines([
      ['Status', h.status],
      ['Disclosure version', h.disclosureVersion],
      ['Disclosure acknowledged', iso(h.disclosureAckAt)],
      ['Buyer key version', h.keyVersion],
      ['Re-keys used', h.rekeysUsed],
      ['Credentials due', iso(h.credentialsDueAt)],
      ['First delivered', iso(h.firstDeliveredAt)],
      ['Last delivered', iso(h.deliveredAt)],
      ['Takeover due', iso(h.takeoverDueAt)],
      ['Taken over', iso(h.takenOverAt)],
      ['Takeover by', h.takeoverSource],
      ['Disputed', iso(h.disputedAt)],
    ]);
    doc.moveDown(0.3).text('Takeover confirmations:');
    if (!game.confirmations.length) doc.text('None.');
    game.confirmations.forEach((c) => doc.text(`${iso(c.at)}  ${c.step}  session ${c.sessionId}`));
    doc.moveDown(0.3).text('Credential-access log (every retrieval of the sealed credentials):');
    if (!game.accessLog.length) doc.text('None.');
    game.accessLog.forEach((a) =>
      doc.text(`${iso(a.at)}  user ${a.userId}  session ${a.sessionId}  key version ${a.keyVersion}  address ${a.sourceIp ?? '—'}`),
    );
  }

  heading(`${game ? 6 : 5}. Hash list (SHA-256)`);
  if (!hashes.length) doc.text('No files.');
  hashes.forEach(([what, sha]) => doc.text(`${sha}  ${what}`));
  doc.end();
  return done;
}
