import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { Staff } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { AreasService } from '../services/areas.service';
import { FareTableService } from '../services/fare-table.service';
import { AreaDto, AreaPatchDto, FareTableDto } from './delivery.dto';

// Administrators maintain the drop-off areas and publish fare tables (section 3.1; CP-43, FR-OPS-08; U4-02).
// Meetup points come with U4-03.
const staffOf = (p: Principal) => {
  if (p.type !== 'staff') throw new Problem('forbidden');
  return p;
};

@Controller('admin')
export class DeliveryAdminController {
  constructor(
    private readonly areas: AreasService,
    private readonly fares: FareTableService,
  ) {}

  @Staff('administrator')
  @Post('areas')
  @HttpCode(201)
  addArea(@Body() dto: AreaDto, @CurrentPrincipal() p: Principal) {
    return this.areas.create(staffOf(p).staffId, dto);
  }

  @Staff('administrator')
  @Patch('areas/:id')
  changeArea(@Param('id', new ParseIntPipe({ exceptionFactory: () => new Problem('not-found') })) id: number, @Body() dto: AreaPatchDto, @CurrentPrincipal() p: Principal) {
    return this.areas.update(staffOf(p).staffId, id, dto);
  }

  /** The version in force, as the starting point of the next one. */
  @Staff('administrator')
  @Get('fare-tables/current')
  currentFares() {
    return this.fares.current();
  }

  @Staff('administrator')
  @Post('fare-tables')
  @HttpCode(201)
  publishFares(@Body() dto: FareTableDto, @CurrentPrincipal() p: Principal) {
    return this.fares.publish(staffOf(p).staffId, dto);
  }
}
