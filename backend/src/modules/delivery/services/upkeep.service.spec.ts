import { DV_30_MS, DV_31, UpkeepService } from './upkeep.service';

// U4-05 with the database, Redis and Unit 2 faked: which rows each job picks and what it does with them. The jobs run
// against PostgreSQL in test/api/courier.spec.ts and test/api/handover.spec.ts.

const NOW = new Date('2026-12-01T10:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const DAY = 86_400_000;

type Answer = (sql: string, params: unknown[]) => unknown;
function setup(answer: Answer, o: { escrow?: (id: string) => unknown; query?: (id: string) => Promise<unknown>; leased?: string[] } = {}) {
  const query = jest.fn(async (sql: string, params: unknown[] = []) => answer(sql, params));
  const statuses = { query: jest.fn(o.query ?? (async () => ({ outcome: 'applied' }))) };
  const orders = { getEscrow: jest.fn(async (id: string) => { const e = o.escrow?.(id); if (e instanceof Error) throw e; return e; }) };
  const params = { current: async () => ({ ms: (k: string, sub: string) => (k === 'CP-32' && sub === 'retention' ? 30 * DAY : 0) }) };
  const leased = new Set(o.leased ?? []);
  const redis = { set: jest.fn(async (key: string) => { if (leased.has(key)) return null; leased.add(key); return 'OK'; }) };
  const svc = new UpkeepService({ query } as never, statuses as never, orders as never, params as never, redis as never, { now: () => NOW });
  return { svc, query, statuses, orders, redis };
}

describe('UpkeepService', () => {
  it('DV-31 FR-DLV-10 shipments in flight silent for 6 hours are asked about once per lease; one failure does not stop the rest', async () => {
    const s = setup(
      (sql) => (sql.includes('shipment_history') ? [{ id: 'S1', consignment_id: 'C1' }, { id: 'S2', consignment_id: 'C2' }, { id: 'S3', consignment_id: 'C3' }] : []),
      { leased: ['delivery:reconcile:S3'], query: async (id) => { if (id === 'S1') throw new Error('courier down'); return {}; } },
    );
    expect(await s.svc.reconcile()).toEqual({ done: 1, failed: 1 });
    expect(s.statuses.query.mock.calls).toEqual([['S1', 'C1'], ['S2', 'C2']]); // S3 is leased by another instance
    const [, params] = s.query.mock.calls[0];
    expect(params).toEqual([['booked', 'picked_up', 'in_transit', 'delivery_failed'], ago(DV_31.silentMs)]);
    expect(s.redis.set).toHaveBeenCalledWith('delivery:reconcile:S1', '1', 'EX', DV_31.leaseSeconds, 'NX');
  });

  it('FR-DLV-04 open proposals whose meeting time has passed lapse', async () => {
    const s = setup((sql) => (sql.includes("SET status = 'lapsed'") ? [[{ id: 'P1' }, { id: 'P2' }], 2] : []));
    expect(await s.svc.lapseProposals()).toBe(2);
    expect(s.query.mock.calls[0][0]).toContain("status = 'proposed' AND meet_at <= $1");
    expect(s.query.mock.calls[0][1]).toEqual([NOW]);
  });

  it('DV-30 addresses are erased 30 days after the order closed, or after a cancelled shipment ended, never while a dispute is open', async () => {
    const rows = [
      { id: 'cancelled', order_id: 'O1', status: 'cancelled', final_at: ago(31 * DAY) },
      { id: 'closed-long-ago', order_id: 'O2', status: 'delivered', final_at: ago(40 * DAY) },
      { id: 'closed-recently', order_id: 'O3', status: 'delivered', final_at: ago(35 * DAY) },
      { id: 'still-open', order_id: 'O4', status: 'delivered', final_at: ago(35 * DAY) },
      { id: 'disputed', order_id: 'O5', status: 'returned_to_seller', final_at: ago(35 * DAY) },
      { id: 'escrow-error', order_id: 'O6', status: 'delivered', final_at: ago(35 * DAY) },
      { id: 'update-fails', order_id: 'O2', status: 'delivered', final_at: ago(40 * DAY) },
    ];
    const escrow: Record<string, unknown> = {
      O1: { closedAt: ago(31 * DAY), openDisputeId: null },
      O2: { closedAt: ago(31 * DAY), openDisputeId: null },
      O3: { closedAt: ago(10 * DAY), openDisputeId: null },
      O4: { closedAt: null, openDisputeId: null },
      O5: { closedAt: ago(40 * DAY), openDisputeId: 'D1' },
      O6: new Error('not-found'),
    };
    const s = setup((sql, params) => {
      if (sql.includes('addresses_erased_at IS NULL AND status IN')) return rows;
      if (sql.includes('SET pickup_address_enc = NULL')) {
        if (params[0] === 'update-fails') throw new Error('connection lost');
        return [[{ id: params[0] }], 1];
      }
      return [];
    }, { escrow: (id) => escrow[id] });
    expect(await s.svc.eraseAddresses()).toEqual({ done: 2, failed: 1 });
    const erased = s.query.mock.calls.filter(([q]) => String(q).includes('SET pickup_address_enc = NULL')).map(([, p]) => (p as string[])[0]);
    expect(erased).toEqual(['cancelled', 'closed-long-ago', 'update-fails']);
    expect(s.query.mock.calls[0][1]).toEqual([ago(DV_30_MS)]);
    expect(s.orders.getEscrow.mock.calls.filter(([id]) => id === 'O2')).toHaveLength(1); // asked once per order
  });

  it('SEC-PAY-04 provider event ids are deleted after CP-32\'s retention, and only those', async () => {
    const s = setup((sql) => (sql.startsWith('DELETE') ? [[], 7] : []));
    expect(await s.svc.purgeProviderEvents()).toBe(7);
    expect(s.query.mock.calls[0]).toEqual(['DELETE FROM delivery.provider_events WHERE received_at < $1', [ago(30 * DAY)]]);
    const none = setup(() => undefined);
    expect(await none.svc.purgeProviderEvents()).toBe(0);
  });
});
