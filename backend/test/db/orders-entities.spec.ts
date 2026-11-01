import { randomUUID } from 'crypto';
import { ENTITIES, LedgerAccount, Order, OrdersOutboxEvent } from '../../src/modules/orders/db/entities';
import { inRolledBackTransaction } from '../support/db';
import { entityChecks } from '../support/entity-check';
import { IdentityFixtures } from '../support/identity';

// U2-01: the orders and payments entities against the migrated database (the design SQL is the reference).
// A schema change that is not reflected in the entities fails here (regenerate with
// scripts/generate_entities.py --schemas orders,payments ...). Reads pg_catalog as tb_app.
describe('orders and payments entities', () => {
  const checks = entityChecks({ label: 'orders and payments', schemas: ['orders', 'payments'], entities: ENTITIES, tables: 18 });

  let fx: IdentityFixtures;
  beforeAll(async () => {
    fx = await IdentityFixtures.open();
  });
  afterAll(async () => fx?.close());

  it('DC-4 money columns are bigint poisha read as strings, never floating point', async () => {
    const accounts = await checks.ds().getRepository(LedgerAccount).find();
    expect(accounts.length).toBeGreaterThan(0); // the seeded chart of accounts
    const meta = checks.ds().getMetadata(Order);
    for (const name of ['unit_price', 'item_price', 'delivery_fee', 'total']) {
      expect(meta.columns.find((c) => c.databaseName === name)?.type).toBe('bigint');
    }
  });

  it('SEC-INF-03 the application account writes and reads an order through the entity (enums, bigint, jsonb)', async () => {
    const buyer = await fx.user();
    const seller = await fx.user();
    const saved = await inRolledBackTransaction(async (q) => {
      const orders = q.manager.getRepository(Order);
      const o = await orders.save(
        orders.create({
          kind: 'fixed_price', listingId: randomUUID(), itemKind: 'physical', buyerId: buyer, sellerId: seller, quantity: 1,
          unitPrice: '1250000', itemPrice: '1250000', fulfilment: 'self_pickup', deliveryFee: '0', total: '1250000',
          listingSnapshot: { title: 'Probe' }, commissionBps: 500, deliveryMarginBps: 1000, paramsVersion: 1,
          status: 'awaiting_payment', paymentDueAt: new Date(Date.now() + 3_600_000),
        }),
      );
      return orders.findOneByOrFail({ id: o.id });
    }, ENTITIES);
    expect(saved).toMatchObject({ status: 'awaiting_payment', total: '1250000', listingSnapshot: { title: 'Probe' } });
    expect(typeof saved.total).toBe('string');
  });

  it('DC-6 the orders outbox accepts only orders and payments event names', async () => {
    await expect(
      inRolledBackTransaction((q) => q.manager.getRepository(OrdersOutboxEvent).insert({ eventType: 'identity.user.registered', aggregateId: randomUUID(), payload: {} }), ENTITIES),
    ).rejects.toThrow();
    const ok = await inRolledBackTransaction(
      (q) => q.manager.getRepository(OrdersOutboxEvent).insert({ eventType: 'payments.payout.sent', aggregateId: randomUUID(), payload: {} }),
      ENTITIES,
    );
    expect(ok.identifiers).toHaveLength(1);
  });
});
