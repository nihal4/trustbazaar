import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditEvent } from '../db/entities';
import type { ActorType } from '../db/enums';

// The hash-chained audit log (SEC-LOG-01 to SEC-LOG-04; Unit 1 DC-8 and section 5.3). record() is always
// called with the transaction of the action it records, so both commit or neither does. The chain position
// and hashes are set by the database trigger under an advisory lock; tb_app may only insert and read, so
// the log is append-only through the application. verifyChain() recomputes every hash in the database
// (audit.verify_chain) and reports the first entry that does not match.
export interface AuditEntry {
  actorType: ActorType;
  actorId?: string | null;
  action: string; // 'identity.signin.succeeded'
  objectType?: string | null;
  objectId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  approvalId?: string | null;
  sourceIp?: string | null;
  correlationId?: string | null;
}

export interface AuditQuery {
  actorId?: string;
  objectId?: string;
  action?: string; // a prefix: 'staff.' matches every staff action
  from?: Date;
  to?: Date;
  /** Entries before this chain position (newest first paging). */
  before?: string;
  limit?: number;
}

export interface AuditRow {
  id: string;
  chainPos: string;
  at: Date;
  actorType: ActorType;
  actorId: string | null;
  action: string;
  objectType: string | null;
  objectId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  approvalId: string | null;
  sourceIp: string | null;
  correlationId: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly db: DataSource) {}

  async record(manager: EntityManager, entry: AuditEntry): Promise<void> {
    await manager.getRepository(AuditEvent).insert({
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      objectType: entry.objectType ?? null,
      objectId: entry.objectId ?? null,
      beforeState: entry.before ?? undefined,
      afterState: entry.after ?? undefined,
      reason: entry.reason ?? null,
      approvalId: entry.approvalId ?? null,
      sourceIp: entry.sourceIp ?? null,
      correlationId: entry.correlationId ?? null,
    });
  }

  /** SEC-LOG-02: intact, or the id of the first entry (in chain order) whose hash or link does not match. */
  async verifyChain(): Promise<{ intact: boolean; firstBadId?: string; entries: number }> {
    const [{ bad, n }] = await this.db.query(`SELECT audit.verify_chain()::text AS bad, (SELECT count(*) FROM audit.events)::int AS n`);
    return bad === null ? { intact: true, entries: n } : { intact: false, firstBadId: bad, entries: n };
  }

  /** SEC-LOG-04: read-only, newest first; at most 200 entries a page. */
  async list(q: AuditQuery): Promise<AuditRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.actorId) add('actor_id = ?', q.actorId);
    if (q.objectId) add('object_id = ?', q.objectId);
    if (q.action) add(`action LIKE ? || '%'`, q.action.replace(/[%_\\]/g, '\\$&'));
    if (q.from) add('at >= ?', q.from);
    if (q.to) add('at < ?', q.to);
    if (q.before) add('chain_pos < ?', q.before);
    params.push(Math.min(Math.max(q.limit ?? 50, 1), 200));
    const rows = await this.db.query(
      `SELECT id::text, chain_pos::text, at, actor_type, actor_id, action, object_type, object_id, before_state, after_state,
              reason, approval_id, host(source_ip) AS source_ip, correlation_id
       FROM audit.events ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY chain_pos DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      chainPos: r.chain_pos as string,
      at: r.at as Date,
      actorType: r.actor_type as ActorType,
      actorId: r.actor_id as string | null,
      action: r.action as string,
      objectType: r.object_type as string | null,
      objectId: r.object_id as string | null,
      before: r.before_state,
      after: r.after_state,
      reason: r.reason as string | null,
      approvalId: r.approval_id as string | null,
      sourceIp: r.source_ip as string | null,
      correlationId: r.correlation_id as string | null,
    }));
  }
}
