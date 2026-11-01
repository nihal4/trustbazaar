import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { SignedIn } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { NotificationService } from '../services/notification.service';
import { MarkReadDto, NotificationsQuery, PreferencesDto } from './notifications.dto';

// The notification centre and preferences (docs/design/06_chat_notifications.pdf section 3.1; U6-04).
const userOf = (p: Principal) => {
  if (p.type !== 'user') throw new Problem('forbidden');
  return p;
};

@Controller()
export class NotificationsController {
  constructor(private readonly notices: NotificationService) {}

  /** FR-NTF-04: history, newest first, in the user's language, with the unread count. */
  @SignedIn()
  @Get('notifications')
  list(@CurrentPrincipal() p: Principal, @Query() q: NotificationsQuery) {
    return this.notices.list(userOf(p).userId, q.cursor);
  }

  @SignedIn()
  @Post('notifications/read')
  @HttpCode(200)
  read(@CurrentPrincipal() p: Principal, @Body() dto: MarkReadDto) {
    return this.notices.markRead(userOf(p).userId, dto.all === true ? 'all' : dto.ids ?? []);
  }

  /** FR-NTF-05 */
  @SignedIn()
  @Get('me/notification-preferences')
  preferences(@CurrentPrincipal() p: Principal) {
    return this.notices.preferences(userOf(p).userId);
  }

  @SignedIn()
  @Put('me/notification-preferences')
  setPreferences(@CurrentPrincipal() p: Principal, @Body() dto: PreferencesDto) {
    return this.notices.setPreferences(userOf(p).userId, dto);
  }
}
