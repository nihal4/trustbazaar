import { Body, Controller, Delete, Get, HttpCode, Param, ParseEnumPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Staff } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import type { CaseType } from '../ports';
import { DetectionTermsService } from '../services/detection-terms.service';
import { HoldService } from '../services/hold.service';
import { DetectionTermDto, DetectionTermQuery } from './chat.dto';

// Staff access to chat (docs/design/06_chat_notifications.pdf section 3.1; FR-CHT-07, FR-CHT-10; U6-03).
const staffOf = (p: Principal) => {
  if (p.type !== 'staff') throw new Problem('forbidden');
  return p;
};
const Id = (name: string) => Param(name, new ParseUUIDPipe({ exceptionFactory: () => new Problem('not-found') }));
const CASE_TYPES = { dispute: 'dispute', report: 'report' } as const;

@Controller('staff')
export class ChatStaffController {
  constructor(
    private readonly holds: HoldService,
    private readonly terms: DetectionTermsService,
  ) {}

  /** FR-CHT-10: a thread, for a case that holds it; every read is logged (chat.staff_access_log). */
  @Staff('operator')
  @Get('cases/:type/:caseId/threads/:id')
  read(
    @Param('type', new ParseEnumPipe(CASE_TYPES, { exceptionFactory: () => new Problem('not-found') })) type: CaseType,
    @Id('caseId') caseId: string,
    @Id('id') id: string,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.holds.staffRead(staffOf(p), type, caseId, id);
  }

  /** The detection terms (FR-CHT-07); GET added to the design's POST and DELETE (Decisions log, U6-03). */
  @Staff('operator')
  @Get('chat/detection-terms')
  list() {
    return this.terms.list();
  }

  @Staff('operator')
  @Post('chat/detection-terms')
  @HttpCode(201)
  add(@Body() dto: DetectionTermDto, @CurrentPrincipal() p: Principal) {
    return this.terms.add(staffOf(p).staffId, dto.term, dto.flag);
  }

  @Staff('operator')
  @Delete('chat/detection-terms')
  @HttpCode(204)
  async remove(@Query() q: DetectionTermQuery, @CurrentPrincipal() p: Principal): Promise<void> {
    await this.terms.remove(staffOf(p).staffId, q.term);
  }
}
