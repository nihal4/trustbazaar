import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface, QueryRunner, TransactionCommitEvent, TransactionRollbackEvent } from 'typeorm';
import { LIVE, LiveAuthenticator, LivePort } from '../../../kernel/live/live';
import { USER_COOKIES } from './cookies';
import { SessionAuthenticator } from './session-auth';

// Unit 1's part of the live connection (K-07; SEC-SES-07).
//  - LiveAuth: a WebSocket handshake carries the same access-token cookie as an HTTP request, and passes the same
//    session check (SessionAuthenticator). Only user sessions: the staff console has no live channel in the design.
//  - SessionSocketCloser: when a session ends, its connections are closed once the ending transaction has committed.
//    Closing earlier could let the client reconnect while the session still looked live; on a rollback nothing
//    happens. The gateway's periodic re-check covers anything missed.
export function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

@Injectable()
export class LiveAuth implements LiveAuthenticator {
  constructor(private readonly sessions: SessionAuthenticator) {}

  async authenticate(cookieHeader: string | undefined): Promise<{ userId: string; sessionId: string } | 'expired' | null> {
    const p = await this.sessions.authenticate(cookieValue(cookieHeader, USER_COOKIES.access), 'user');
    if (p === null || p === 'expired') return p;
    return p.type === 'user' ? { userId: p.userId, sessionId: p.sessionId } : null;
  }

  liveSessions(sessionIds: string[]): Promise<Set<string>> {
    return this.sessions.liveSessions(sessionIds);
  }
}

@Injectable()
export class SessionSocketCloser implements EntitySubscriberInterface, OnModuleInit {
  private readonly pending = new WeakMap<QueryRunner, Set<string>>();

  constructor(
    private readonly db: DataSource,
    @Inject(LIVE) private readonly live: LivePort,
  ) {}

  onModuleInit(): void {
    this.db.subscribers.push(this);
  }

  /** Called by SessionService for each session it ends, in the ending transaction. */
  ended(runner: QueryRunner | undefined, sessionId: string): void {
    if (!runner?.isTransactionActive) return this.live.endSession(sessionId);
    const set = this.pending.get(runner) ?? new Set<string>();
    set.add(sessionId);
    this.pending.set(runner, set);
  }

  afterTransactionCommit(e: TransactionCommitEvent): void {
    const set = this.pending.get(e.queryRunner);
    this.pending.delete(e.queryRunner);
    for (const id of set ?? []) this.live.endSession(id);
  }

  afterTransactionRollback(e: TransactionRollbackEvent): void {
    this.pending.delete(e.queryRunner);
  }
}
