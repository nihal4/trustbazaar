import { Module } from '@nestjs/common';

// Unit 6 (docs/design/06_chat_notifications.pdf). Schemas: chat, notify.
// E-mail and SMS adapters live in adapters/.
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
@Module({
  imports: [],
  providers: [],
  exports: [],
})
export class ChatModule {}
