import { Problem } from '../../../kernel/http/problems';
import { GameJobs } from '../jobs/game.jobs';
import { GameJobsService, RETENTION } from './game-jobs.service';

// U5-05 with the database, Units 1, 2 and 7 faked: what each job asks of the database and the other units, and the
// overdue re-key left for the next run while Unit 7 refuses game-account disputes. The same against PostgreSQL:
// test/api/game-jobs.spec.ts.
const T = new Date('2026-12-01T10:00:00Z');

function setup(rows: Record<string, unknown>[], answer: (sql: string) => unknown, o: { dispute?: () => Promise<string>; erase?: () => Promise<void> } = {}) {
  const queue = [...rows];
  const sqls: string[] = [];
  const query = jest.fn(async (sql: string, _p?: unknown[]) => {
    sqls.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
    if (sql.includes('SKIP LOCKED')) return queue.length ? [queue.shift()] : [];
    const r = answer(sql);
    if (r instanceof Error) throw r;
    return r;
  });
  const m = { query };
  const db = { query, transaction: async <R>(fn: (x: unknown) => Promise<R>) => fn(m) };
  const orders = { lockForFulfilment: jest.fn(async () => ({})) };
  const escrow = { recordDeliveryEvent: jest.fn(async () => undefined) };
  const disputes = { open: jest.fn(o.dispute ?? (async () => 'D')) };
  const vault = { erase: jest.fn(o.erase ?? (async () => undefined)) };
  const takeover = { completed: jest.fn(async () => undefined) };
  const svc = new GameJobsService(db as never, orders as never, escrow as never, disputes as never, vault as never, takeover as never);
  return { svc, query, sqls, orders, escrow, disputes, vault, takeover };
}

describe('GameJobsService', () => {
  it('FR-GAM-15 the window-end job completes due takeovers at the window\'s end, records Unit 2\'s delivery event and tells both parties', async () => {
    let n = 0;
    const s = setup([{ order_id: 'O1', buyer_id: 'B1' }, { order_id: 'O2', buyer_id: 'B2' }], (q) => (q.includes('complete_if_due') ? [{ at: n++ === 0 ? T : null }] : [])); // O2: confirmed meanwhile
    expect(await s.svc.completeDueTakeovers()).toBe(1);
    expect(s.orders.lockForFulfilment.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['O1', 'O2']);
    expect(s.escrow.recordDeliveryEvent).toHaveBeenCalledWith('O1', 'game_takeover', T, expect.anything());
    expect(s.takeover.completed.mock.calls).toEqual([['O1', 'B1']]);
  });

  it('DV-37 an overdue re-key becomes a credentials_invalid dispute; while Unit 7 refuses it the handover is left for the next run', async () => {
    const s = setup([{ order_id: 'O1' }, { order_id: 'O2' }], () => [{ moved: true }]);
    expect(await s.svc.disputeOverdueRekeys()).toBe(2);
    expect(s.disputes.open.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      expect.objectContaining({ orderId: 'O1', type: 'credentials_invalid', by: 'system' }), expect.objectContaining({ orderId: 'O2' }),
    ]);
    const off = setup([{ order_id: 'O1' }], () => [{ moved: true }], { dispute: async () => { throw new Problem('feature-off'); } });
    expect(await off.svc.disputeOverdueRekeys()).toBe(0);
    expect(off.sqls).toContain('ROLLBACK TO SAVEPOINT');
    expect(await setup([{ order_id: 'O1' }], () => [{ moved: false }]).svc.disputeOverdueRekeys()).toBe(0); // answered meanwhile
    await expect(setup([{ order_id: 'O1' }], () => [{ moved: true }], { dispute: async () => { throw new Error('down'); } }).svc.disputeOverdueRekeys()).rejects.toThrow('down');
  });

  it('DV-33 I-63 DV-39 codes past their validity expire; retention purges and erases the screenshot files', async () => {
    expect(await setup([], () => [[], 3]).svc.expireCodes()).toBe(3);
    const s = setup([], () => [{ key: 'k1' }, { key: 'k2' }], { erase: jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('gone')) });
    expect(await s.svc.purge()).toBe(1); // a file that cannot be erased is logged; its key is already gone
    expect(s.query.mock.calls[0][1]).toEqual([RETENTION.accessLog, RETENTION.soldScreenshot, RETENTION.otherScreenshot]);
    expect(s.vault.erase.mock.calls).toEqual([['k1'], ['k2']]);
  });

  it('NFR-REL-03 the four jobs are registered with their intervals', () => {
    const register = jest.fn();
    const svc = { completeDueTakeovers: jest.fn(), disputeOverdueRekeys: jest.fn(), expireCodes: jest.fn(), purge: jest.fn() };
    new GameJobs({ register } as never, svc as never).onModuleInit();
    expect(register.mock.calls.map(([j]) => [(j as { name: string }).name, (j as { intervalMs: number }).intervalMs])).toEqual([
      ['game_accounts.takeover_window_end', 60_000], ['game_accounts.rekey_overdue', 300_000], ['game_accounts.proof_expiry', 3_600_000], ['game_accounts.retention', 86_400_000],
    ]);
    for (const [j] of register.mock.calls) (j as { run: () => void }).run();
    expect([svc.completeDueTakeovers, svc.disputeOverdueRekeys, svc.expireCodes, svc.purge].every((f) => f.mock.calls.length === 1)).toBe(true);
  });
});
