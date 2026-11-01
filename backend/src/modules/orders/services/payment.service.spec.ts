import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { DataSource } from 'typeorm';
import type { Clock } from '../../../kernel/clock';
import { Secret, TbConfig } from '../../../kernel/config/config';
import { ConfigPort, parameterValues } from '../../../kernel/config-port';
import type { IdempotencyKeys } from '../../../kernel/http/idempotency';
import { Problem } from '../../../kernel/http/problems';
import type { AuditServicePort } from '../../identity/ports';
import { signState } from '../adapters/callback-state';
import { PaymentProvider, ProviderUnavailable, VerifiedResult } from '../adapters/payment-provider';
import { Escrow, EscrowHistory, JournalEntry, JournalLine, Order, OrdersOutboxEvent, PaymentAttempt, ReconciliationIssue, Refund } from '../db/entities';
import { MockPayController, PaymentsController, StripeWebhookController } from '../http/payments.controller';
import { PaymentService, ProviderRegistry } from './payment.service';

// Unit tests of PaymentService and its controllers over an in-memory stand-in for TypeORM. The same flows
// against PostgreSQL are in test/api/payments.spec.ts and payments-stripe.spec.ts.
type Row = Record<string, unknown>;
const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => row[k] === v);
class Repo {
  rows: Row[] = [];
  constructor(private readonly defaults: () => Row = () => ({})) {}
  async findOne(o: { where: Row }) {
    return this.rows.find((r) => matches(r, o.where)) ?? null;
  }
  async findOneBy(where: Row) {
    return this.rows.find((r) => matches(r, where)) ?? null;
  }
  async findOneByOrFail(where: Row) {
    const r = await this.findOneBy(where);
    if (!r) throw new Error('EntityNotFound');
    return { ...r };
  }
  async countBy(where: Row) {
    return this.rows.filter((r) => matches(r, where)).length;
  }
  async insert(obj: Row) {
    const row = { id: randomUUID(), ...this.defaults(), ...obj };
    this.rows.push(row);
    return { identifiers: [{ id: row.id }] };
  }
  async update(where: Row, patch: Row) {
    for (const r of this.rows.filter((x) => matches(x, where))) Object.assign(r, patch);
  }
}

const NOW = new Date('2026-11-01T12:00:00Z');
const KEY = 'test-callback-state-key';

function setup(o: { mode?: 'mock' | 'sandbox'; providers?: ProviderRegistry; seen?: boolean } = {}) {
  const repos = new Map<unknown, Repo>([
    [Order, new Repo()], [PaymentAttempt, new Repo(() => ({ status: 'created', providerPaymentId: null, idempotencyKey: randomUUID() }))], [Escrow, new Repo()], [EscrowHistory, new Repo()],
    [JournalEntry, new Repo()], [JournalLine, new Repo()], [OrdersOutboxEvent, new Repo()], [ReconciliationIssue, new Repo()], [Refund, new Repo()],
  ]);
  const events = new Set<string>();
  const manager = {
    getRepository: (e: unknown) => repos.get(e)!,
    query: jest.fn(async (sql: string, p: unknown[] = []) => {
      if (!sql.includes('INSERT INTO payments.provider_events')) return [];
      const key = `${p[0]}:${p[1]}`;
      if (events.has(key) || o.seen) return [];
      events.add(key);
      return [{ id: '1' }];
    }),
  };
  const db = { ...manager, manager, transaction: (cb: (m: typeof manager) => unknown) => cb(manager) };
  const provider = (id: 'bkash' | 'stripe', confirmation: 'callback' | 'webhook') =>
    ({
      id, confirmation,
      createPayment: jest.fn(async (a: { id: string }) => ({ providerPaymentId: `pp_${a.id}`, redirectUrl: `https://pay/${a.id}` })),
      redirectUrl: jest.fn(async (a: { id: string }) => `https://pay/${a.id}`),
      query: jest.fn(),
    }) as unknown as jest.Mocked<PaymentProvider>;
  const providers = o.providers ?? { bkash: provider('bkash', 'callback'), stripe: provider('stripe', 'webhook') };
  const audit = { record: jest.fn(async () => undefined) };
  const values = parameterValues({ 'CP-15': '7 days', 'CP-16': '3 days', 'CP-22': '24 hours', 'CP-32': { tolerance: '5 minutes', retention: '30 days' } });
  const params = { current: async () => ({ ...values, version: 1 }), atVersion: async () => values } as unknown as ConfigPort;
  const config = { paymentMode: o.mode ?? 'mock', publicOrigin: 'https://tb', secrets: { callbackStateKey: new Secret('CALLBACK_STATE_KEY', KEY) }, providers: {} } as unknown as TbConfig;
  const idempotency = { once: async (_s: string, _u: string, _k: string | undefined, fn: () => Promise<string>) => ({ id: await fn(), repeated: false }) };
  const clock: Clock = { now: () => NOW };
  const svc = new PaymentService(db as unknown as DataSource, idempotency as unknown as IdempotencyKeys, providers, audit as unknown as AuditServicePort, params, config, clock);
  const order = (x: Row = {}) => {
    const row = { id: randomUUID(), buyerId: 'B', sellerId: 'S', status: 'awaiting_payment', fulfilment: 'self_pickup', total: '150000', paymentDueAt: new Date(NOW.getTime() + 5 * 60_000), listingSnapshot: { title: 'Phone' }, itemKind: 'physical', paramsVersion: 1, kind: 'fixed_price', listingId: 'L', quantity: 1, deliveryQuoteId: null, ...x };
    repos.get(Order)!.rows.push(row);
    return row;
  };
  return { svc, repo: (e: unknown) => repos.get(e)!, providers: providers as Record<string, jest.Mocked<PaymentProvider>>, order, audit, config };
}

const problemOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    if (err instanceof Problem) return [err.problem, ...((err.extra.errors as { field: string; reason: string }[] | undefined) ?? []).map((e) => `${e.field}:${e.reason}`)];
    throw err;
  }
  throw new Error('no problem raised');
};
const result = (attemptId: string, x: Partial<VerifiedResult> = {}): VerifiedResult => ({
  eventId: `e-${randomUUID()}`, eventType: 'mock.payment.succeeded', providerPaymentId: `pp_${attemptId}`, providerTxnId: 'txn', status: 'succeeded', amount: 150000n,
  currency: 'BDT', merchantReference: attemptId, verifiedBy: 'query', payload: '{}', ...x,
});

describe('PaymentService.start (FR-PAY-01)', () => {
  it('FR-PAY-01 the attempt is the order total, committed before the provider, and extends the hold once (DV-11)', async () => {
    const s = setup();
    const o = s.order();
    const r = await s.svc.start('B', o.id, 'bkash', undefined);
    expect(r).toMatchObject({ provider: 'bkash', amount: '150000', redirectUrl: `https://pay/${r.attemptId}`, expiresAt: new Date(NOW.getTime() + 15 * 60_000).toISOString() });
    expect(o.paymentDueAt).toEqual(new Date(NOW.getTime() + 15 * 60_000));
    o.paymentDueAt = new Date(NOW.getTime() + 60_000);
    await s.svc.start('B', o.id, 'stripe', undefined);
    expect(o.paymentDueAt).toEqual(new Date(NOW.getTime() + 60_000)); // not extended twice
    expect(s.repo(PaymentAttempt).rows[1].expiresAt).toEqual(new Date(NOW.getTime() + 31 * 60_000)); // Stripe's minimum session
  });

  it('FR-PAY-01 refused for another user, the seller, a closed or expired order, no method, or a provider not in this mode', async () => {
    const s = setup({ providers: { bkash: setup().providers.bkash } });
    const o = s.order();
    expect(await problemOf(s.svc.start('B', o.id, 'stripe', undefined))).toEqual(['feature-off', 'provider:not-available-in-this-mode']);
    expect(await problemOf(s.svc.start('X', o.id, 'bkash', undefined))).toEqual(['not-found']);
    expect(await problemOf(s.svc.start('S', o.id, 'bkash', undefined))).toEqual(['forbidden']);
    expect(await problemOf(s.svc.start('B', s.order({ status: 'paid' }).id, 'bkash', undefined))).toEqual(['order-state']);
    expect(await problemOf(s.svc.start('B', s.order({ paymentDueAt: NOW }).id, 'bkash', undefined))).toEqual(['order-state']);
    expect(await problemOf(s.svc.start('B', s.order({ fulfilment: null }).id, 'bkash', undefined))).toEqual(['order-state', 'fulfilment:choose-before-paying']);
  });

  it('FR-PAY-16 a provider that cannot be reached fails the attempt and answers provider-unavailable', async () => {
    const s = setup();
    const o = s.order();
    s.providers.bkash.createPayment.mockRejectedValueOnce(new ProviderUnavailable('down'));
    expect(await problemOf(s.svc.start('B', o.id, 'bkash', undefined))).toEqual(['provider-unavailable']);
    expect(s.repo(PaymentAttempt).rows[0]).toMatchObject({ status: 'failed', failureCode: 'provider_unavailable' });
    s.providers.bkash.createPayment.mockRejectedValueOnce(new Error('bug'));
    await expect(s.svc.start('B', o.id, 'bkash', undefined)).rejects.toThrow('bug');
  });
});

describe('PaymentService.confirm (FR-PAY-02 to FR-PAY-05)', () => {
  async function started(s: ReturnType<typeof setup>, x: Row = {}) {
    const o = s.order(x);
    const { attemptId } = await s.svc.start('B', o.id, 'bkash', undefined);
    return { o, a: s.repo(PaymentAttempt).rows.find((r) => r.id === attemptId)! };
  }

  it('FR-PAY-05 a matching payment: paid with the deadline of its method, escrow held, ledger, event, audit', async () => {
    for (const [fulfilment, step, ms, policy] of [['self_pickup', 'meetup_handover', 7 * 86_400_000, 'standard'], ['courier', 'courier_pickup', 3 * 86_400_000, 'standard'], ['game_account', 'credentials_delivered', 86_400_000, 'game_protection']] as const) {
      const s = setup();
      const { o, a } = await started(s, { fulfilment, itemKind: fulfilment === 'game_account' ? 'game_account' : 'physical' });
      expect(await s.svc.confirm('bkash', result(a.id as string))).toBe('paid');
      expect(o).toMatchObject({ status: 'paid', paidAt: NOW, fulfilmentStep: step, fulfilmentDueAt: new Date(NOW.getTime() + ms) });
      expect(s.repo(Escrow).rows[0]).toMatchObject({ orderId: o.id, releasePolicy: policy, amountCollected: '150000' });
      expect(s.repo(JournalLine).rows.map((l) => [l.accountCode, l.amount])).toEqual([['provider_clearing', '150000'], ['escrow_liability', '-150000']]);
      expect(s.repo(OrdersOutboxEvent).rows[0]).toMatchObject({ eventType: 'orders.order.paid', payload: { listingId: 'L', quantity: 1, fulfilmentStep: step } });
      expect(s.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'orders.order.paid', actorType: 'provider' }), expect.anything());
    }
  });

  it('SEC-PAY-04 a recorded event, a second event for a decided attempt, pending and failed results', async () => {
    const s = setup();
    const { o, a } = await started(s);
    const r = result(a.id as string);
    expect(await s.svc.confirm('bkash', r)).toBe('paid');
    expect(await s.svc.confirm('bkash', r)).toBe('already-processed');
    expect(await s.svc.confirm('bkash', result(a.id as string))).toBe('no-change');
    const other = await started(s);
    expect(await s.svc.confirm('bkash', result(other.a.id as string, { status: 'pending' }))).toBe('pending');
    expect(await s.svc.confirm('bkash', result(other.a.id as string, { status: 'failed', eventType: 'mock.payment.failed' }))).toBe('failed');
    expect(other.a).toMatchObject({ status: 'failed', failureCode: 'mock.payment.failed' });
    expect(o.status).toBe('paid');
    expect(await setup({ seen: true }).svc.confirm('bkash', r)).toBe('already-processed');
  });

  it('FR-PAY-03 a mismatch, a late and a duplicate payment are owed back; the first two raise an issue', async () => {
    const s = setup();
    const m = await started(s);
    expect(await s.svc.confirm('bkash', result(m.a.id as string, { amount: 140000n }))).toBe('rejected');
    expect(await s.svc.confirm('bkash', result((await started(s)).a.id as string, { currency: 'USD' }))).toBe('rejected');
    const late = await started(s);
    late.o.status = 'cancelled';
    expect(await s.svc.confirm('bkash', result(late.a.id as string))).toBe('late');
    const paid = await started(s);
    const second = await s.svc.start('B', paid.o.id, 'bkash', undefined);
    await s.svc.confirm('bkash', result(paid.a.id as string));
    expect(await s.svc.confirm('bkash', result(second.attemptId))).toBe('duplicate');
    expect(s.repo(Refund).rows.map((r) => [r.reason, r.amount])).toEqual([['amount_mismatch', '140000'], ['amount_mismatch', '150000'], ['late_payment', '150000'], ['duplicate_payment', '150000']]);
    expect(s.repo(ReconciliationIssue).rows.map((i) => i.kind)).toEqual(['amount_mismatch', 'amount_mismatch', 'late_payment']);
    const zero = await started(s);
    expect(await s.svc.confirm('bkash', result(zero.a.id as string, { amount: 0n }))).toBe('rejected');
    expect(s.repo(Refund).rows).toHaveLength(4); // nothing to give back
  });

  it('FR-PAY-15 an event for no known attempt is raised as provider_disagrees; found by the provider id otherwise', async () => {
    const s = setup();
    expect(await s.svc.confirm('bkash', result('not-a-uuid', { providerPaymentId: 'unknown' }))).toBe('no-change');
    expect(s.repo(ReconciliationIssue).rows[0]).toMatchObject({ kind: 'provider_disagrees' });
    const { a } = await started(s);
    expect(await s.svc.confirm('bkash', result('', { providerPaymentId: a.providerPaymentId as string }))).toBe('rejected'); // reference missing: a mismatch
    const st = await s.svc.start('B', s.order().id, 'stripe', undefined);
    expect(await s.svc.confirm('bkash', result(st.attemptId))).toBe('no-change'); // the attempt belongs to another provider
    expect(await s.svc.confirm('bkash', result('', { providerPaymentId: '' }))).toBe('no-change');
  });

  it('FR-PAY-02 callbacks need the signed state and a callback provider; reconcile and status read the attempt', async () => {
    const s = setup();
    const { a } = await started(s);
    s.providers.bkash.query.mockImplementation(async () => result(a.id as string)); // a fresh event id each time
    const state = signState(KEY, a.id as string);
    expect(await problemOf(s.svc.callback('bkash', a.id as string, 'forged'))).toEqual(['link-invalid']);
    expect(await problemOf(s.svc.callback('stripe', a.id as string, state))).toEqual(['not-found']);
    expect(await s.svc.callback('bkash', a.id as string, state)).toMatchObject({ outcome: 'paid' });
    expect(await s.svc.reconcile(a.id as string)).toBe('no-change');
    expect(await s.svc.status(a.id as string)).toEqual({ status: 'succeeded' });
    expect(await problemOf(s.svc.status(randomUUID()))).toEqual(['not-found']);
    expect(await s.svc.mockAttempt(a.id as string, state)).toMatchObject({ provider: 'bkash', callbackUrl: expect.stringContaining(`/api/v1/callbacks/bkash/${a.id}?state=`) });
    expect(await problemOf(s.svc.mockAttempt(randomUUID(), signState(KEY, 'x')))).toEqual(['link-invalid']);
    const unknown = randomUUID();
    expect(await problemOf(s.svc.mockAttempt(unknown, signState(KEY, unknown)))).toEqual(['not-found']);
    expect(await problemOf(setup({ mode: 'sandbox' }).svc.mockAttempt(a.id as string, state))).toEqual(['not-found']);
  });

  it('I-52 a repeated start whose attempt failed says so', async () => {
    const s = setup();
    const o = s.order();
    const id = randomUUID();
    s.repo(PaymentAttempt).rows.push({ id, orderId: o.id, provider: 'bkash', amount: '1', status: 'failed', expiresAt: NOW, idempotencyKey: 'k' });
    (s.svc as unknown as { idempotency: IdempotencyKeys }).idempotency = { once: async () => ({ id, repeated: true }) } as unknown as IdempotencyKeys;
    expect(await problemOf(s.svc.start('B', o.id, 'bkash', 'key-12345678'))).toEqual(['order-state', 'attempt:failed']);
  });
});

describe('payment controllers', () => {
  const user = { type: 'user', userId: 'B', sessionId: 's', accountStatus: 'active', kycStatus: 'verified', emailVerified: true } as const;
  const res = () => ({ redirect: jest.fn(), status: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(), send: jest.fn() });

  it('FR-PAY-01 and FR-PAY-02 start, return and callback hand on to PaymentService', async () => {
    const svc = { start: jest.fn(), status: jest.fn(), callback: jest.fn(async () => ({ orderId: 'o', outcome: 'paid' })) };
    const c = new PaymentsController(svc as unknown as PaymentService, { publicOrigin: 'https://tb' } as TbConfig);
    await c.start('o', { provider: 'bkash' }, 'k', user);
    expect(svc.start).toHaveBeenCalledWith('B', 'o', 'bkash', 'k');
    await c.status('nagad', 'a');
    expect(() => c.status('paypal', 'a')).toThrow(Problem);
    const r = res();
    await c.callback('bkash', 'a', 'st', r as never);
    expect(r.redirect).toHaveBeenCalledWith(303, 'https://tb/orders/o?payment=a&result=paid');
    expect(() => c.start('o', { provider: 'bkash' }, undefined, { type: 'staff', staffId: 's', sessionId: 's', role: 'operator' })).toThrow(Problem);
  });

  it('SEC-PAY-03 the webhook exists in sandbox mode only, and only a valid signature reaches confirm', async () => {
    const svc = { confirm: jest.fn(async () => 'paid') };
    const params = { current: async () => parameterValues({ 'CP-32': { tolerance: '5 minutes' } }) } as unknown as ConfigPort;
    const clock = { now: () => new Date(1_000_000_000) };
    const mock = new StripeWebhookController(svc as unknown as PaymentService, { paymentMode: 'mock', providers: {} } as unknown as TbConfig, params, clock);
    expect(await problemOf(mock.stripe({ rawBody: Buffer.from('{}') } as never, 'x'))).toEqual(['not-found']);
    const sb = new StripeWebhookController(svc as unknown as PaymentService, { paymentMode: 'sandbox', providers: { stripeWebhookSecret: new Secret('S', 'whsec_k') } } as unknown as TbConfig, params, clock);
    expect(await problemOf(sb.stripe({} as never, 't=1,v1=00'))).toEqual(['validation-failed', 'Stripe-Signature:invalid']);
    const { createHmac } = await import('crypto');
    const sign = (b: string) => `t=1000000,v1=${createHmac('sha256', 'whsec_k').update(`1000000.${b}`).digest('hex')}`;
    const other = '{"id":"e","type":"customer.created","data":{"object":{}}}';
    expect(await sb.stripe({ rawBody: Buffer.from(other) } as never, sign(other))).toEqual({ received: true, handled: false });
    const done = JSON.stringify({ id: 'e2', type: 'checkout.session.completed', data: { object: { id: 'cs', client_reference_id: 'a', amount_total: 1, currency: 'bdt', payment_status: 'paid' } } });
    expect(await sb.stripe({ rawBody: Buffer.from(done) } as never, sign(done))).toEqual({ received: true, outcome: 'paid' });
  });

  it('C-2 the mock page shows the amount with a strict policy, and the decision goes back through the callback', async () => {
    const svc = { mockAttempt: jest.fn(async () => ({ provider: 'bkash', amount: '1234567', status: 'redirected', callbackUrl: 'https://tb/api/v1/callbacks/bkash/a?state=s' })) };
    const store = new Map<string, string>([['mockpay:a', JSON.stringify({ amount: '1234567', status: 'pending' })]]);
    const redis = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => void store.set(k, v) };
    const c = new MockPayController(svc as unknown as PaymentService, redis as unknown as Redis);
    const page = res();
    await c.page('a', 's"<', page as never);
    const html = page.send.mock.calls[0][0] as string;
    expect(html).toContain('BDT 12,345.67');
    expect(html).toContain('state=s%22%3C');
    expect(page.set.mock.calls[0][0]['Content-Security-Policy']).toContain("default-src 'none'");
    const r = res();
    await c.decide('a', 's', { outcome: 'succeeded' }, r as never);
    expect(r.redirect).toHaveBeenCalledWith(303, 'https://tb/api/v1/callbacks/bkash/a?state=s');
    expect(JSON.parse(store.get('mockpay:a')!).status).toBe('succeeded');
    await c.page('a', undefined, res() as never);
  });
});
