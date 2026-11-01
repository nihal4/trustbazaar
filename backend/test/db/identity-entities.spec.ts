import { ENTITIES, AuditEvent, User } from '../../src/modules/identity/db/entities';
import { entityChecks } from '../support/entity-check';
import { inRolledBackTransaction } from '../support/db';

// U1-01: the identity and audit entities against the migrated database (the design SQL is the reference).
// A schema change that is not reflected in the entities fails here (regenerate with
// scripts/generate_entities.py). Reads pg_catalog as tb_app.
const SCHEMAS = ['identity', 'audit'];

describe('identity and audit entities', () => {
  entityChecks({ label: 'identity and audit', schemas: SCHEMAS, entities: ENTITIES, tables: 21 });

  it('SEC-INF-03 the application account writes and reads a user through the entity (citext, enums, defaults)', async () => {
    const found = await inRolledBackTransaction(async (q) => {
      const users = q.manager.getRepository(User);
      const saved = await users.save(
        users.create({
          displayName: 'Probe',
          phoneE164: '+8801711999996',
          phoneVerifiedAt: new Date(),
          email: 'probe.entity@tb.test',
          passwordHash: '$argon2id$v=19$x',
          passwordSingleFactorOk: true,
          adultConfirmedAt: new Date(),
        }),
      );
      const again = await users.findOneByOrFail({ email: 'PROBE.ENTITY@TB.TEST' });
      return { savedId: saved.id, again };
    }, ENTITIES);
    expect(found.again.id).toBe(found.savedId);
    expect(found.again.kycStatus).toBe('unsubmitted'); // the column default
    expect(found.again.accountStatus).toBe('active');
  });

  it('SEC-LOG-04 an audit event inserted through the entity gets its chain position and hash from the database', async () => {
    const event = await inRolledBackTransaction(async (q) => {
      const events = q.manager.getRepository(AuditEvent);
      const { identifiers } = await events.insert({ actorType: 'system', action: 'test.entity.insert' });
      return events.findOneByOrFail({ id: identifiers[0].id });
    }, ENTITIES);
    expect(typeof event.id).toBe('string');
    expect(Number(event.chainPos)).toBeGreaterThan(0);
    expect(Buffer.isBuffer(event.hash) && event.hash.length).toBe(32);
    expect(event.at).toBeInstanceOf(Date);
  });
});
