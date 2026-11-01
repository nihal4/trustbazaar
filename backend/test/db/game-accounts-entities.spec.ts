import { randomUUID } from 'crypto';
import { ENTITIES, Game, GameAccountsOutboxEvent } from '../../src/modules/game-accounts/db/entities';
import { inRolledBackTransaction } from '../support/db';
import { entityChecks } from '../support/entity-check';

// U5-01: the game_accounts entities against the migrated database (the design SQL is the reference).
// A schema change that is not reflected in the entities fails here (regenerate with
// scripts/generate_entities.py --schemas game_accounts ...). Reads pg_catalog as tb_app.
describe('game_accounts entities', () => {
  entityChecks({ label: 'game_accounts', schemas: ['game_accounts'], entities: ENTITIES, tables: 10 });

  it('SEC-INF-03 the application account writes a game through the entity, its platforms as an array', async () => {
    const saved = await inRolledBackTransaction(async (q) => {
      const games = q.manager.getRepository(Game);
      const g = await games.save(
        games.create({
          slug: `probe-${randomUUID().slice(0, 8)}`, name: 'Probe Game', platforms: ['android', 'ios'],
          codePlacement: 'In the profile bio', publisherNote: 'Written by the entity probe.', active: true,
        }),
      );
      return games.findOneByOrFail({ id: g.id });
    }, ENTITIES);
    expect(saved).toMatchObject({ name: 'Probe Game', platforms: ['android', 'ios'], active: true });
    expect(typeof saved.id).toBe('number');
  });

  it('DC-6 the game_accounts outbox accepts only game_accounts event names', async () => {
    await expect(
      inRolledBackTransaction((q) => q.manager.getRepository(GameAccountsOutboxEvent).insert({ eventType: 'delivery.issue.opened', aggregateId: randomUUID(), payload: {} }), ENTITIES),
    ).rejects.toThrow();
    const ok = await inRolledBackTransaction(
      (q) => q.manager.getRepository(GameAccountsOutboxEvent).insert({ eventType: 'game_accounts.credentials.delivered', aggregateId: randomUUID(), payload: {} }),
      ENTITIES,
    );
    expect(ok.identifiers).toHaveLength(1);
  });
});
