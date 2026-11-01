import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { EventBus, OutboxEvent } from '../../src/kernel/events/event-bus';
import { MAX_ATTEMPTS, OutboxDispatcher } from '../../src/kernel/events/outbox-dispatcher';
import { ConfigService } from '../../src/modules/trust/services/config.service';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// K-04: the outbox dispatcher over the seven outboxes (DC-6, DV-67; docs/design/09_integration.pdf section
// 3.2), against PostgreSQL. The background poller is off in this file; the tests drain by hand.
const OUTBOX_PREFIX: Record<string, string> = {
  identity: 'identity', orders: 'orders', auctions: 'auctions', delivery: 'delivery', game_accounts: 'game_accounts', chat: 'chat', disputes: 'disputes',
};

describe('outbox dispatcher', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let bus: EventBus;
  let dispatcher: OutboxDispatcher;
  const before = process.env.OUTBOX_DISPATCHER;

  beforeAll(async () => {
    process.env.OUTBOX_DISPATCHER = 'off';
    t = await startApp();
    fx = await IdentityFixtures.open();
    bus = t.app.get(EventBus);
    dispatcher = t.app.get(OutboxDispatcher);
    // whatever earlier test files left behind: with the job runner off in tests (U2-07) nothing drains the
    // outboxes between files, and one drain takes at most a batch of 100 per outbox
    for (let i = 0; i < 200; i++) {
      const r = await dispatcher.drain();
      if (r.dispatched + r.failed + r.givenUp === 0) break;
    }
  });
  afterAll(async () => {
    if (before === undefined) delete process.env.OUTBOX_DISPATCHER;
    else process.env.OUTBOX_DISPATCHER = before;
    await fx?.close();
    await t?.close();
  });

  /** A fresh event type per test, so consumers registered by one test never see another's events. */
  const kind = () => `k${randomUUID().replace(/-/g, '').slice(0, 10).replace(/\d/g, 'x')}`;
  // Written as already due: the database stamps next_attempt_at in microseconds, the dispatcher compares it
  // with the clock in milliseconds, so an event drained within the same millisecond would otherwise wait for
  // the next pass (harmless in production, where the next poll takes it; a flaky assertion here).
  const emit = async (outbox: string, type: string) => {
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO ${outbox}.outbox (event_type, aggregate_id, payload, next_attempt_at)
       VALUES ($1, $2, '{"n": 1}', now() - interval '1 second') RETURNING id::text`,
      [type, randomUUID()],
    );
    return id;
  };
  const row = async (outbox: string, id: string) =>
    (await fx.query<{ attempts: number; dispatched_at: Date | null; next_attempt_at: Date }>(
      `SELECT attempts, dispatched_at, next_attempt_at FROM ${outbox}.outbox WHERE id = $1`, [id]))[0];
  const due = (outbox: string, id: string) => fx.query(`UPDATE ${outbox}.outbox SET next_attempt_at = now() - interval '1 second' WHERE id = $1`, [id]);

  it('DC-6 an event from each of the seven outboxes reaches its consumers once and is marked dispatched', async () => {
    const k = kind();
    const seen: OutboxEvent[] = [];
    const ids: Record<string, string> = {};
    for (const [outbox, prefix] of Object.entries(OUTBOX_PREFIX)) {
      bus.on(`${prefix}.${k}.happened`, 'test.collector', async (e) => void seen.push(e));
      ids[outbox] = await emit(outbox, `${prefix}.${k}.happened`);
    }
    await dispatcher.drain();
    await dispatcher.drain();
    expect(seen.map((e) => e.outbox).sort()).toEqual(Object.keys(OUTBOX_PREFIX).sort());
    expect(seen[0]).toMatchObject({ payload: { n: 1 }, attempt: 1 });
    for (const [outbox, id] of Object.entries(ids)) expect((await row(outbox, id)).dispatched_at).toBeInstanceOf(Date);
  });

  it('DV-67 a failing consumer is retried with a growing delay; the others are called again and absorb it', async () => {
    const type = `orders.${kind()}.paid`;
    let flaky = 0;
    const steady: string[] = [];
    bus.on(type, 'test.flaky', async () => {
      if (++flaky < 3) throw new Error('provider timeout');
    });
    bus.on(type, 'test.steady', async (e) => {
      if (!steady.includes(e.id)) steady.push(e.id); // idempotent: records what it processed
    });
    const id = await emit('orders', type);

    await dispatcher.drain();
    let r = await row('orders', id);
    expect(r).toMatchObject({ attempts: 1, dispatched_at: null });
    const firstDelay = r.next_attempt_at.getTime() - Date.now();
    expect(firstDelay).toBeGreaterThan(3_000);
    expect(firstDelay).toBeLessThanOrEqual(5_000);

    await dispatcher.drain(); // not due yet
    expect(flaky).toBe(1);
    await due('orders', id);
    await dispatcher.drain();
    r = await row('orders', id);
    expect(r.attempts).toBe(2);
    expect(r.next_attempt_at.getTime() - Date.now()).toBeGreaterThan(8_000); // 10 s

    await due('orders', id);
    await dispatcher.drain();
    expect((await row('orders', id)).dispatched_at).toBeInstanceOf(Date);
    expect(flaky).toBe(3);
    expect(steady).toEqual([id]);
  });

  it('DV-67 after 10 failed attempts an event is reported and no longer retried', async () => {
    const type = `chat.${kind()}.sent`;
    let calls = 0;
    bus.on(type, 'test.broken', async () => {
      calls++;
      throw new Error('always fails');
    });
    const id = await emit('chat', type);
    await fx.query(`UPDATE chat.outbox SET attempts = $2 WHERE id = $1`, [id, MAX_ATTEMPTS - 1]);
    const r = await dispatcher.drain();
    expect(r.givenUp).toBeGreaterThanOrEqual(1);
    await due('chat', id);
    await dispatcher.drain();
    expect(calls).toBe(1);
    expect(await row('chat', id)).toMatchObject({ attempts: MAX_ATTEMPTS, dispatched_at: null });
  });

  it('NFR-REL-03 two dispatchers draining at once deliver every event exactly once (SKIP LOCKED)', async () => {
    const type = `delivery.${kind()}.booked`;
    const calls = new Map<string, number>();
    bus.on(type, 'test.counter', async (e) => {
      calls.set(e.id, (calls.get(e.id) ?? 0) + 1);
      await new Promise((res) => setTimeout(res, 5));
    });
    const ids = await Promise.all(Array.from({ length: 30 }, () => emit('delivery', type)));
    const other = new OutboxDispatcher(t.app.get(DataSource), bus, { now: () => new Date() });
    await Promise.all([dispatcher.drain(), other.drain(), dispatcher.drain()]);
    expect([...calls.keys()].sort()).toEqual([...ids].sort());
    expect([...calls.values()].every((n) => n === 1)).toBe(true);
  });

  it('DC-6 an event nobody consumes is marked dispatched', async () => {
    const id = await emit('auctions', `auctions.${kind()}.ended`);
    await dispatcher.drain();
    expect((await row('auctions', id)).dispatched_at).toBeInstanceOf(Date);
  });

  it('DV-50 staff.config.published refreshes the parameter cache of every instance', async () => {
    const config = t.app.get(ConfigService);
    const spy = jest.spyOn(config, 'invalidate');
    await fx.query(`INSERT INTO disputes.outbox (event_type, aggregate_id, payload) VALUES ('staff.config.published', $1, '{"version": 0}')`, [randomUUID()]);
    await dispatcher.drain();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
