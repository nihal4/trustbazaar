import { randomUUID } from 'crypto';
import { DataExportRequest, DisputesOutboxEvent, ENTITIES } from '../../src/modules/trust/db/entities';
import { inRolledBackTransaction } from '../support/db';
import { entityChecks } from '../support/entity-check';
import { IdentityFixtures } from '../support/identity';

// U7-02: the disputes, trust and staff entities against the migrated database (the design SQL is the
// reference). A schema change that is not reflected in the entities fails here (regenerate with
// scripts/generate_entities.py --schemas disputes,trust,staff ...). Reads pg_catalog as tb_app.
// trust.profile_summary is a view, read with SQL; it has no entity.
describe('disputes, trust and staff entities', () => {
  entityChecks({ label: 'disputes, trust and staff', schemas: ['disputes', 'trust', 'staff'], entities: ENTITIES, tables: 15 });

  let fx: IdentityFixtures;
  beforeAll(async () => {
    fx = await IdentityFixtures.open();
  });
  afterAll(async () => fx?.close());

  it('SEC-INF-03 the application account writes an export request through the entity; one pending request per user', async () => {
    const user = await fx.user();
    const outcome = await inRolledBackTransaction(async (q) => {
      const requests = q.manager.getRepository(DataExportRequest);
      const r = await requests.save(requests.create({ userId: user }));
      const saved = await requests.findOneByOrFail({ id: r.id });
      // the last statement: a refusal aborts the transaction, which is rolled back anyway
      const second = await requests.insert({ userId: user }).then(() => 'accepted', () => 'refused');
      return { saved, second };
    }, ENTITIES);
    expect(outcome.saved).toMatchObject({ userId: user, readyAt: null, fileKey: null, expiresAt: null });
    expect(outcome.saved.requestedAt).toBeInstanceOf(Date);
    expect(outcome.second).toBe('refused');
  });

  it('DC-6 the disputes outbox accepts only disputes, trust and staff event names', async () => {
    await expect(
      inRolledBackTransaction((q) => q.manager.getRepository(DisputesOutboxEvent).insert({ eventType: 'orders.order.paid', aggregateId: randomUUID(), payload: {} }), ENTITIES),
    ).rejects.toThrow();
    const ok = await inRolledBackTransaction(
      (q) => q.manager.getRepository(DisputesOutboxEvent).insert({ eventType: 'disputes.dispute.opened', aggregateId: randomUUID(), payload: {} }),
      ENTITIES,
    );
    expect(ok.identifiers).toHaveLength(1);
  });
});
