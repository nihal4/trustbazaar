import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditEvent } from '../db/entities';
import type { ActorType } from '../db/enums';

// Writes the hash-chained audit log (SEC-LOG-01, SEC-LOG-02; Unit 1 DC-8). Always called with the
// transaction of the action it records, so both commit or neither does. The chain position and hashes are
// set by the database trigger. U1-07 adds chain verification and exposes this to other units as a port.
export interface AuditEntry {
  actorType: ActorType;
  actorId?: string | null;
  action: string; // 'identity.signin.succeeded'
  objectType?: string | null;
  objectId?: string | null;
  reason?: string | null;
  sourceIp?: string | null;
  correlationId?: string | null;
}

@Injectable()
export class AuditService {
  async record(manager: EntityManager, entry: AuditEntry): Promise<void> {
    await manager.getRepository(AuditEvent).insert({
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      objectType: entry.objectType ?? null,
      objectId: entry.objectId ?? null,
      reason: entry.reason ?? null,
      sourceIp: entry.sourceIp ?? null,
      correlationId: entry.correlationId ?? null,
    });
  }
}
