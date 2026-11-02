import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SignedIn } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { BlockService } from '../services/block.service';
import { ChatService } from '../services/chat.service';
import { MarksDto, MessagesQuery, PostImageDto, PostTextDto, ThreadsQuery } from './chat.dto';

// Chat (docs/design/06_chat_notifications.pdf section 3.1; FR-CHT-01 to FR-CHT-05, FR-CHT-08; U6-02). The
// "Participant" policy is SignedIn here plus ChatService's check, which answers not-found to anyone else.
// Reports (POST /threads/{id}/reports) come with U6-03.
const userOf = (p: Principal) => {
  if (p.type !== 'user') throw new Problem('forbidden');
  return p;
};
const Id = (name: string) => Param(name, new ParseUUIDPipe({ exceptionFactory: () => new Problem('not-found') }));
/** The multipart cap; the image's own limit (CP-33) is applied by FileVault. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService, private readonly blocks: BlockService) {}

  /** FR-CHT-01: opens, or finds, the caller's thread with the seller of an active listing. */
  @SignedIn()
  @Post('listings/:id/threads')
  @HttpCode(200)
  open(@Id('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.chat.open(userOf(p).userId, id);
  }

  @SignedIn()
  @Get('threads')
  threads(@CurrentPrincipal() p: Principal, @Query() q: ThreadsQuery) {
    return this.chat.threads(userOf(p).userId, q.cursor);
  }

  /** FR-CHT-02, IF-COM-02: the messages after a sequence number, 200 a page (DV-44). */
  @SignedIn()
  @Get('threads/:id/messages')
  messages(@Id('id') id: string, @Query() q: MessagesQuery, @CurrentPrincipal() p: Principal) {
    return this.chat.messages(userOf(p), id, q.after ?? 0);
  }

  @SignedIn()
  @Post('threads/:id/messages')
  @HttpCode(200)
  postText(@Id('id') id: string, @Body() dto: PostTextDto, @CurrentPrincipal() p: Principal) {
    return this.chat.postText(userOf(p).userId, id, dto.clientId, dto.text);
  }

  /** FR-CHT-03 */
  @SignedIn()
  @Post('threads/:id/images')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 2, fieldSize: 1200, parts: 3 } }))
  postImage(@Id('id') id: string, @Body() dto: PostImageDto, @UploadedFile() file: { buffer: Buffer } | undefined, @CurrentPrincipal() p: Principal) {
    return this.chat.postImage(userOf(p).userId, id, dto.clientId, file?.buffer, dto.caption);
  }

  /** FR-CHT-05; the socket's chat.ack does the same. */
  @SignedIn()
  @Post('threads/:id/marks')
  @HttpCode(204)
  async marks(@Id('id') id: string, @Body() dto: MarksDto, @CurrentPrincipal() p: Principal): Promise<void> {
    await this.chat.mark(userOf(p).userId, id, dto.delivered, dto.read);
  }

  /** FR-CHT-08 */
  @SignedIn()
  @Post('blocks/:userId')
  @HttpCode(204)
  async block(@Id('userId') userId: string, @CurrentPrincipal() p: Principal): Promise<void> {
    await this.blocks.block(userOf(p).userId, userId);
  }

  @SignedIn()
  @Delete('blocks/:userId')
  @HttpCode(204)
  async unblock(@Id('userId') userId: string, @CurrentPrincipal() p: Principal): Promise<void> {
    await this.blocks.unblock(userOf(p).userId, userId);
  }
}
