import { randomUUID } from 'crypto';
import { AuctionsOutboxEvent, Category, ENTITIES, Listing } from '../../src/modules/listings/db/entities';
import { inRolledBackTransaction } from '../support/db';
import { entityChecks } from '../support/entity-check';
import { IdentityFixtures } from '../support/identity';

// U3-01: the listings and auctions entities against the migrated database (the design SQL is the reference).
// A schema change that is not reflected in the entities fails here (regenerate with
// scripts/generate_entities.py --schemas listings,auctions ...). Reads pg_catalog as tb_app.
describe('listings and auctions entities', () => {
  entityChecks({ label: 'listings and auctions', schemas: ['listings', 'auctions'], entities: ENTITIES, tables: 15 });

  let fx: IdentityFixtures;
  beforeAll(async () => {
    fx = await IdentityFixtures.open();
  });
  afterAll(async () => fx?.close());

  it('SEC-INF-03 the application account writes a listing through the entity; the search column is the database\'s', async () => {
    const seller = await fx.user();
    const saved = await inRolledBackTransaction(async (q) => {
      const cat = await q.manager.getRepository(Category).save({
        slug: `probe-${randomUUID().slice(0, 8)}`, nameEn: 'Phones', nameBn: 'ফোন', itemKind: 'physical', prohibited: false, sortOrder: 1,
      });
      const listings = q.manager.getRepository(Listing);
      const l = await listings.save(
        listings.create({
          sellerId: seller, itemKind: 'physical', saleFormat: 'fixed_price', categoryId: cat.id, title: 'Probe phone for sale',
          description: 'A phone listed by the entity probe, never published.', condition: 'used', noVisibleDefects: true,
          fulfilmentOptions: 'pickup_only', areaDistrict: 'Dhaka', approxLat: '23.811', approxLng: '90.412', price: '1500000',
          quantityTotal: 1, quantityAvailable: 1, status: 'draft',
        }),
      );
      return listings.findOneByOrFail({ id: l.id });
    }, ENTITIES);
    expect(saved).toMatchObject({ status: 'draft', price: '1500000', quantitySold: 0, sellerVisible: true });
    expect(saved.searchTsv).toContain("'phone'"); // GENERATED ALWAYS from the title and description
  });

  it('DC-6 the auctions outbox accepts only listings and auctions event names', async () => {
    await expect(
      inRolledBackTransaction((q) => q.manager.getRepository(AuctionsOutboxEvent).insert({ eventType: 'orders.order.paid', aggregateId: randomUUID(), payload: {} }), ENTITIES),
    ).rejects.toThrow();
    const ok = await inRolledBackTransaction(
      (q) => q.manager.getRepository(AuctionsOutboxEvent).insert({ eventType: 'auctions.bid.outbid', aggregateId: randomUUID(), payload: {} }),
      ENTITIES,
    );
    expect(ok.identifiers).toHaveLength(1);
  });
});
