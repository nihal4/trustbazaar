import { randomUUID } from 'crypto';
import { ChatOutboxEvent, ENTITIES, NotificationTemplate } from '../../src/modules/chat/db/entities';
import { inRolledBackTransaction } from '../support/db';
import { entityChecks } from '../support/entity-check';

// U6-01: the chat and notify entities against the migrated database (the design SQL is the reference).
// A schema change that is not reflected in the entities fails here (regenerate with
// scripts/generate_entities.py --schemas chat,notify ...). Reads pg_catalog as tb_app.
describe('chat and notify entities', () => {
  entityChecks({ label: 'chat and notify', schemas: ['chat', 'notify'], entities: ENTITIES, tables: 15 });

  it('SEC-INF-03 the application account writes a template through the entity, its channels as an enum array', async () => {
    const code = `probe.t${randomUUID().slice(0, 8).replace(/[0-9]/g, 'x')}`;
    const saved = await inRolledBackTransaction(async (q) => {
      const templates = q.manager.getRepository(NotificationTemplate);
      await templates.save(
        templates.create({
          code, version: 1, category: 'security', channels: ['sms', 'email'], allowedParams: ['code'],
          titleEn: 'Probe', titleBn: 'প্রোব', bodyEn: 'Your code is {code}.', bodyBn: 'আপনার কোড {code}।', active: true,
        }),
      );
      return templates.findOneByOrFail({ code, version: 1 });
    }, ENTITIES);
    expect(saved).toMatchObject({ category: 'security', channels: ['sms', 'email'], allowedParams: ['code'] });
  });

  it('DC-6 the chat outbox accepts only chat event names', async () => {
    await expect(
      inRolledBackTransaction((q) => q.manager.getRepository(ChatOutboxEvent).insert({ eventType: 'delivery.issue.opened', aggregateId: randomUUID(), payload: {} }), ENTITIES),
    ).rejects.toThrow();
    const ok = await inRolledBackTransaction(
      (q) => q.manager.getRepository(ChatOutboxEvent).insert({ eventType: 'chat.message.flagged', aggregateId: randomUUID(), payload: {} }),
      ENTITIES,
    );
    expect(ok.identifiers).toHaveLength(1);
  });
});
