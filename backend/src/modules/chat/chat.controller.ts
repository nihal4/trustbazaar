import { Controller, Get } from '@nestjs/common';
import { ChatService } from './chat.service';

// TODO(FR-59–FR-64): Per-listing real-time chat threads
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('health')
  health() {
    return { module: 'chat', status: 'scaffolded', requirements: 'FR-59–FR-64' };
  }
}
