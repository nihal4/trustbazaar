import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { IsObject, IsString, Length } from 'class-validator';
import type { Request } from 'express';
import { correlationId } from '../../../kernel/http/correlation';
import { Staff } from '../../../kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../../kernel/http/principal';
import { Problem } from '../../../kernel/http/problems';
import { ConfigAdminService } from '../services/config-admin.service';

// The parameter editor's API (FR-OPS-03, FR-OPS-08, FR-OPS-09): administrators only.
export class ConfigChangesDto {
  /** Parameter code -> new value, in the stored form, for example {"CP-13": "20 minutes"}. */
  @IsObject()
  changes!: Record<string, unknown>;
}

export class ConfigPublishDto extends ConfigChangesDto {
  @IsString()
  @Length(10, 1000)
  reason!: string;
}

const staffId = (p: Principal) => {
  if (p.type !== 'staff') throw new Problem('forbidden');
  return p.staffId;
};
const ctx = (req: Request) => ({ ip: req.ip ?? null, correlationId: correlationId(req) });

@Controller('admin/config')
export class ConfigController {
  constructor(private readonly admin: ConfigAdminService) {}

  @Staff('administrator')
  @Get()
  current() {
    return this.admin.currentSet();
  }

  @Staff('administrator')
  @Get('versions')
  versions() {
    return this.admin.versions();
  }

  /** FR-OPS-09: every broken rule at once, without publishing. */
  @Staff('administrator')
  @Post('validate')
  @HttpCode(200)
  async validate(@Body() dto: ConfigChangesDto) {
    return { violations: await this.admin.violations(dto.changes) };
  }

  /** 201 {version}; switches, CP-30 and CP-36 answer four-eyes-required. */
  @Staff('administrator')
  @Post()
  publish(@Body() dto: ConfigPublishDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.admin.publish(dto.changes, staffId(p), dto.reason, ctx(req));
  }

  /** SEC-IRM-04: proposes a four-eyes change; a second administrator decides it under /staff/approvals. */
  @Staff('administrator')
  @Post('proposals')
  @HttpCode(202)
  propose(@Body() dto: ConfigPublishDto, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.admin.propose(dto.changes, staffId(p), dto.reason, ctx(req));
  }
}
