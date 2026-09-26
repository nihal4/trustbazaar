import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
} from '@nestjs/websockets';
import { Server } from 'socket.io';

// Live bid updates, countdown sync, chat delivery, outbid/notification push.
// SRS 3 (Real-Time Layer) + NFR-2 (state propagation within 1s) + NFR-19
// (must run on Redis pub/sub once there is more than one app server instance
// — do NOT keep per-connection state only in this process's memory).
@WebSocketGateway({ cors: { origin: process.env.FRONTEND_ORIGIN ?? '*' } })
export class RealtimeGateway {
  @WebSocketServer()
  server: Server;

  @SubscribeMessage('auction:join')
  handleJoinAuction(@MessageBody() data: { listingId: string }) {
    // TODO: join a room per listingId, push current highest bid + time
    // remaining on join so a late viewer isn't stuck waiting for the next event.
    return { event: 'auction:joined', data };
  }

  @SubscribeMessage('chat:join')
  handleJoinThread(@MessageBody() data: { threadId: string }) {
    // TODO: join a room per threadId; authorize that the connecting user is
    // actually a participant before allowing the join (NFR-5, IDOR protection).
    return { event: 'chat:joined', data };
  }

  // Called by the auctions service after a bid is accepted — not a client-
  // triggered event. Broadcasts the new highest bid to every viewer in the room.
  broadcastBidAccepted(listingId: string, payload: unknown) {
    this.server.to(listingId).emit('auction:bid_accepted', payload);
  }
}
