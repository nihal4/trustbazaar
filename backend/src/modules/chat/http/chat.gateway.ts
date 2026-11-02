import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { Problem } from '../../../kernel/http/problems';
import { ChatService } from '../services/chat.service';

// chat.ack (docs/design/06_chat_notifications.pdf section 3.2; FR-CHT-05; U6-02): the client reports "delivered up
// to" as soon as a message arrives and "read up to" when it is shown. The connection was authenticated by the
// kernel's gateway (SEC-SES-07), which keeps the user's id in socket.data; ChatService checks the participant.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isSeq = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

@WebSocketGateway()
export class ChatGateway {
  private readonly log = new Logger('ChatGateway');

  constructor(private readonly chat: ChatService) {}

  @SubscribeMessage('chat.ack')
  async ack(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<{ ok: boolean; error?: string }> {
    const userId = (socket.data as { userId?: string }).userId;
    const b = (body ?? {}) as { threadId?: unknown; delivered?: unknown; read?: unknown };
    if (!userId || typeof b.threadId !== 'string' || !UUID.test(b.threadId) || !isSeq(b.delivered) || !isSeq(b.read)) {
      return { ok: false, error: 'invalid' };
    }
    try {
      await this.chat.mark(userId, b.threadId, b.delivered, b.read);
      return { ok: true };
    } catch (err) {
      if (err instanceof Problem) return { ok: false, error: 'not-found' };
      this.log.warn(`chat.ack failed: ${(err as Error).message}`);
      return { ok: false, error: 'failed' };
    }
  }
}
