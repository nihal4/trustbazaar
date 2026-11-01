import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConnectedSocket, MessageBody, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AUCTION_ROOM, LIVE_AUTHENTICATOR, LIVE_ERRORS, LiveAuthenticator, LivePort, MAX_ROOMS, RECHECK_MS } from './live';

// The gateway (K-07; see live.ts). Every connection passes Unit 1's session check when it opens (SEC-SES-07): a
// missing or ended session is refused with 'session-ended', a token past its expiry with 'token-expired' (the
// client refreshes and reconnects, I-51 d). Connections of ended sessions are closed: at once when Unit 1 ends a
// session (endSession, after its commit), and in any case by a re-check of each instance's own connections every
// RECHECK_MS. The client may join only auction rooms; user and session rooms are the server's.
interface SocketData {
  userId: string;
  sessionId: string;
}

@Injectable()
@WebSocketGateway()
export class LiveGateway implements OnGatewayInit, LivePort, OnApplicationShutdown {
  private readonly log = new Logger('LiveGateway');
  private timer?: NodeJS.Timeout;
  @WebSocketServer() server?: Server;

  constructor(private readonly modules: ModuleRef) {}

  /** Unit 1's check, found when the first connection arrives (the kernel cannot import a unit). */
  private get auth(): LiveAuthenticator {
    return this.modules.get<LiveAuthenticator>(LIVE_AUTHENTICATOR, { strict: false });
  }

  afterInit(server: Server): void {
    server.use((socket, next) => {
      void this.auth.authenticate(socket.handshake.headers.cookie).then(
        (r) => {
          if (r === null || r === 'expired') {
            const err = new Error(r === 'expired' ? LIVE_ERRORS.expired : LIVE_ERRORS.unauthenticated) as Error & { data?: unknown };
            err.data = { type: `/problems/${r === 'expired' ? 'token-expired' : 'session-ended'}` };
            return next(err);
          }
          (socket.data as SocketData) = { userId: r.userId, sessionId: r.sessionId };
          void socket.join([`sid:${r.sessionId}`, `user:${r.userId}`]);
          next();
        },
        (e: unknown) => {
          this.log.error(`handshake check failed: ${(e as Error).message}`);
          next(new Error(LIVE_ERRORS.unauthenticated));
        },
      );
    });
    this.timer = setInterval(() => void this.recheck().catch((e: Error) => this.log.warn(`re-check failed: ${e.message}`)), RECHECK_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The client joins an auction room while an auction page is open (Unit 3 section 3.3); any signed-in user may. */
  @SubscribeMessage('join')
  join(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): { ok: boolean; error?: string } {
    const room = (body as { room?: unknown } | null)?.room;
    if (typeof room !== 'string' || !AUCTION_ROOM.test(room)) return { ok: false, error: 'room-not-allowed' };
    const auctions = [...socket.rooms].filter((r) => r.startsWith('auction:'));
    if (!socket.rooms.has(room) && auctions.length >= MAX_ROOMS) return { ok: false, error: 'too-many-rooms' };
    void socket.join(room);
    return { ok: true };
  }

  @SubscribeMessage('leave')
  leave(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): { ok: boolean } {
    const room = (body as { room?: unknown } | null)?.room;
    if (typeof room === 'string' && AUCTION_ROOM.test(room)) void socket.leave(room);
    return { ok: true };
  }

  toUser(userId: string, event: string, payload: Record<string, unknown>): void {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  toRoom(room: `auction:${string}`, event: string, payload: Record<string, unknown>): void {
    this.server?.to(room).emit(event, payload);
  }

  endSession(sessionId: string): void {
    this.server?.in(`sid:${sessionId}`).disconnectSockets(true);
  }

  async isConnected(userId: string): Promise<boolean> {
    if (!this.server) return false;
    try {
      // through the Redis adapter, so a connection on another instance counts too; it waits at most a second
      const sockets = await this.server.in(`user:${userId}`).timeout(1000).fetchSockets();
      return sockets.length > 0;
    } catch {
      return false;
    }
  }

  /** Closes this instance's connections whose session is no longer live (ended, timed out, account closed). */
  async recheck(): Promise<number> {
    if (!this.server) return 0;
    const sockets = await this.server.local.fetchSockets();
    const ids = [...new Set(sockets.map((s) => (s.data as SocketData).sessionId))];
    if (ids.length === 0) return 0;
    const live = await this.auth.liveSessions(ids);
    let closed = 0;
    for (const s of sockets) {
      if (!live.has((s.data as SocketData).sessionId)) {
        s.disconnect(true);
        closed++;
      }
    }
    return closed;
  }
}
