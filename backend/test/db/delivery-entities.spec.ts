import { randomBytes, randomUUID } from 'crypto';
import { Area, DeliveryOutboxEvent, ENTITIES, SavedAddress } from '../../src/modules/delivery/db/entities';
import { inRolledBackTransaction } from '../support/db';
import { entityChecks } from '../support/entity-check';
import { IdentityFixtures } from '../support/identity';

// U4-01: the delivery entities against the migrated database (the design SQL is the reference).
// A schema change that is not reflected in the entities fails here (regenerate with
// scripts/generate_entities.py --schemas delivery ...). Reads pg_catalog as tb_app.
describe('delivery entities', () => {
  entityChecks({ label: 'delivery', schemas: ['delivery'], entities: ENTITIES, tables: 14 });

  let fx: IdentityFixtures;
  beforeAll(async () => {
    fx = await IdentityFixtures.open();
  });
  afterAll(async () => fx?.close());

  it('SEC-INF-03 the application account writes a saved address through the entity; the address is stored as given bytes', async () => {
    const user = await fx.user();
    const sealed = randomBytes(48); // the encrypted address (U4-02 seals it); the database only checks its length
    const saved = await inRolledBackTransaction(async (q) => {
      const area = await q.manager.getRepository(Area).save({
        district: 'Dhaka', nameEn: `Probe ${randomUUID().slice(0, 8)}`, nameBn: 'প্রোব', zone: 'inside_dhaka', lat: '23.811', lng: '90.412', active: true,
      });
      const addresses = q.manager.getRepository(SavedAddress);
      const a = await addresses.save(addresses.create({ userId: user, kind: 'dropoff', label: 'Home', areaId: area.id, addressEnc: sealed }));
      return addresses.findOneByOrFail({ id: a.id });
    }, ENTITIES);
    expect(saved).toMatchObject({ kind: 'dropoff', label: 'Home', deletedAt: null });
    expect(Buffer.compare(saved.addressEnc!, sealed)).toBe(0);
    expect(typeof saved.areaId).toBe('number');
  });

  it('DC-6 the delivery outbox accepts only delivery event names', async () => {
    await expect(
      inRolledBackTransaction((q) => q.manager.getRepository(DeliveryOutboxEvent).insert({ eventType: 'orders.order.paid', aggregateId: randomUUID(), payload: {} }), ENTITIES),
    ).rejects.toThrow();
    const ok = await inRolledBackTransaction(
      (q) => q.manager.getRepository(DeliveryOutboxEvent).insert({ eventType: 'delivery.issue.opened', aggregateId: randomUUID(), payload: {} }),
      ENTITIES,
    );
    expect(ok.identifiers).toHaveLength(1);
  });
});
