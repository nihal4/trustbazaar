import { maskIp } from './dispute-case.service';
import { render } from './evidence-pack.service';

// The evidence pack's PDF and the case file's address masking, without the database (the same through the API:
// test/api/game-disputes.spec.ts).
const T = new Date('2026-12-01T10:00:00Z');
const textOf = (pdf: Buffer) => [...pdf.toString('latin1').matchAll(/\[([^\]]*)\] TJ/g)]
  .map((m) => [...m[1].matchAll(/<([0-9a-f]+)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join('')).join('\n');
const dispute = { id: 'D', order_id: 'O', buyer_id: 'B', seller_id: 'S', item_kind: 'game_account', type: 'seller_recovery', description: 'Taken back.', status: 'decided', opened_by: 'buyer', opened_at: T, outcome: 'full_refund', decision_reason: 'The log shows it.', decided_at: T, assigned_to: 'st' };

describe('evidence pack', () => {
  it('FR-GAM-18 one PDF: the dispute, history, statements, files, Unit 5\'s evidence and the hash list; erased items are marked', async () => {
    const game = {
      details: { game: 'CODM', platform: 'android', playerId: 'p1', contents: 'Legendary.' },
      proof: { code: 'TB-0000-0000', status: 'approved', submittedAt: T, reviewedAt: T, reviewedBy: 'st', liveCheck: 'matched', reason: null, screenshotKey: null, screenshotSha256: 'cd'.repeat(32) },
      handover: { status: 'closed', disclosureVersion: 1, disclosureAckAt: T, keyVersion: 1, rekeysUsed: 0, credentialsDueAt: T, firstDeliveredAt: T, deliveredAt: T, takeoverDueAt: T, takenOverAt: T, takeoverSource: 'checklist', disputedAt: null },
      confirmations: [{ step: 'two_step', at: T, sessionId: 'sess' }],
      accessLog: [{ at: T, userId: 'B', sessionId: 'sess', keyVersion: 1, sourceIp: '203.0.113.9' }],
    };
    const pdf = await render(dispute, [{ from_status: null, to_status: 'open', actor: 'buyer', reason: null, at: T }], [{ party: 'seller', text: null, at: T }],
      [{ id: 'E', party: 'buyer', mime: 'image/jpeg', byte_size: 10, sha256: 'ab'.repeat(32), purged_at: T, at: T }], game,
      [['dispute evidence E', 'ab'.repeat(32)], ['ownership screenshot', 'cd'.repeat(32)]], { by: 'st', at: T });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = textOf(pdf);
    for (const part of ['seller_recovery', 'text erased at the end of retention', 'erased 2026-12-01', 'Player ID: p1', 'Live profile check: matched', 'two_step', 'address 203.0.113.9', '6. Hash list', 'ab'.repeat(32), 'cd'.repeat(32)]) {
      expect(text).toContain(part);
    }
    const physical = textOf(await render({ ...dispute, item_kind: 'physical', outcome: null, decided_at: null }, [], [], [], null, [], { by: 'st', at: T }));
    expect(physical).toContain('5. Hash list');
    expect(physical).toContain('No files.');
  });

  it('SEC-ACC-05 the case file shows an address as its network', () => {
    expect(maskIp('203.0.113.9')).toBe('203.0.113.0/24');
    expect(maskIp('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::/48');
    expect(maskIp(null)).toBeNull();
  });
});
