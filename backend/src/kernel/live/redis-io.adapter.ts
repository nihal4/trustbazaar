import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type Redis from 'ioredis';
import type { IncomingMessage } from 'http';
import type { ServerOptions } from 'socket.io';
import { REDIS } from '../redis.provider';

// Socket.IO with the Redis adapter, so a message to a room reaches its sockets on every backend instance
// (NFR-SCL-01). Only the WebSocket transport (no long-polling, so no sticky sessions; Unit 8 connects with
// transports: ['websocket']), and only from our own origin: a page on another site cannot open a socket that
// carries our cookies (cross-site WebSocket hijacking).
export class RedisIoAdapter extends IoAdapter {
  constructor(
    private readonly ctx: INestApplicationContext,
    private readonly publicOrigin: string,
  ) {
    super(ctx);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const origin = this.publicOrigin;
    const server = super.createIOServer(port, {
      ...options,
      path: '/socket.io',
      transports: ['websocket'],
      serveClient: false,
      maxHttpBufferSize: 16 * 1024, // clients send only small control messages
      allowRequest: (req: IncomingMessage, cb: (err: string | null | undefined, ok: boolean) => void) => cb(null, req.headers.origin === origin),
    });
    const pub = this.ctx.get<Redis>(REDIS).duplicate();
    const sub = pub.duplicate();
    for (const c of [pub, sub]) c.on('error', () => undefined); // reconnects by itself; never an unhandled error
    server.adapter(createAdapter(pub, sub, { key: 'tb:live' }));
    server.of('/').adapter.on('error', () => undefined);
    // On shutdown (DV-66): Socket.IO first, which closes the adapter and its subscriptions, then the two Redis
    // connections, gracefully, so no command still in flight is cut off.
    const close = server.close.bind(server);
    server.close = (fn?: (err?: Error) => void) =>
      close((err?: Error) => {
        void Promise.allSettled([pub.quit(), sub.quit()]).finally(() => fn?.(err));
      });
    return server;
  }
}
