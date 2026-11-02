import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Staff } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { RecordsService } from '../services/records.service';
import { IssuesQuery, ReasonDto, RecordQuery } from './delivery.dto';

// Staff (docs/design/04_delivery.pdf sections 3.1 and 7.11; SEC-ACC-01 to SEC-ACC-05; U4-04): the delivery issue
// queue, its resolution with a reason (audited), and the fulfilment record with masked addresses.
const staffOf = (p: Principal) => {
  if (p.type !== 'staff') throw new Problem('forbidden');
  return p;
};
const Id = (name: string) => Param(name, new ParseUUIDPipe({ exceptionFactory: () => new Problem('not-found') }));

@Controller('staff')
export class DeliveryStaffController {
  constructor(private readonly records: RecordsService) {}

  @Staff('operator')
  @Get('delivery/issues')
  issues(@Query() q: IssuesQuery) {
    return this.records.openIssues(q.cursor);
  }

  @Staff('operator')
  @Post('delivery/issues/:id/resolve')
  @HttpCode(204)
  async resolve(@Id('id') id: string, @Body() dto: ReasonDto, @CurrentPrincipal() p: Principal): Promise<void> {
    await this.records.resolveIssue(id, staffOf(p).staffId, dto.reason);
  }

  /** FR-DSP-05: masked addresses; with ?reason= (10 characters or more) in full, and the display audited (SEC-ACC-05). */
  @Staff('operator')
  @Get('orders/:id/fulfilment-record')
  record(@Id('id') id: string, @Query() q: RecordQuery, @CurrentPrincipal() p: Principal) {
    return this.records.staffRecord(id, staffOf(p).staffId, q.reason);
  }
}
